import { PrismaService } from '@/database/prisma.service'
import { IssueService } from '@/issue/issue.service'
import { PgmqService } from '@/pgmq/pgmq.service'
import { SystemBotId } from '@/user/constants/user.constants'
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common'
import { Prisma } from '@repo/database'
import { CommonPropertyOperationType, SystemPropertyId } from '@repo/shared/property/constants'
import { CodingAgentSnapshotService } from '../coding-agent/coding-agent-snapshot.service'
import { HarnessWorkerCodingAgentWorkflowService } from './coding-agent-workflow.service'
import { HarnessWorkerDevpodService } from './devpod.service'
import {
  DEFAULT_HARNESS_WORKER_DISPATCH_VISIBILITY_TIMEOUT_SECONDS,
  DEFAULT_HARNESS_WORKER_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HARNESS_WORKER_POLL_INTERVAL_MS,
  getHarnessWorkerDispatchQueueName,
  HARNESS_WORKER_BUSY_STATUS,
  HARNESS_WORKER_IDLE_STATUS,
  HARNESS_WORKER_PLAN_IN_REVIEW_ISSUE_STATUS,
  HARNESS_WORKER_PLANNING_ISSUE_STATUS,
  HARNESS_WORKER_QUEUED_ISSUE_STATUS,
} from './worker.constants'
import { HarnessWorkerIssueTrigger } from './worker.types'

type WorkerClaim = {
  issueId: number
  workspaceId: string
}

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerService.name)
  private readonly pollIntervalMs = DEFAULT_HARNESS_WORKER_POLL_INTERVAL_MS
  private readonly dispatchVisibilityTimeoutSeconds = DEFAULT_HARNESS_WORKER_DISPATCH_VISIBILITY_TIMEOUT_SECONDS
  private claimPollTimer: NodeJS.Timeout | null = null
  private dispatchPollTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private isClaimPolling = false
  private isDispatchPolling = false
  private isProcessingClaimedIssue = false
  private isShuttingDown = false
  private workerId: string | null = null
  private claimedIssueId: number | null = null
  private workerStatus = HARNESS_WORKER_IDLE_STATUS

  constructor(
    private readonly prisma: PrismaService,
    private readonly devpodService: HarnessWorkerDevpodService,
    private readonly codingAgentSnapshotService: CodingAgentSnapshotService,
    private readonly codingAgentWorkflowService: HarnessWorkerCodingAgentWorkflowService,
    private readonly issueService: IssueService,
    private readonly pgmqService: PgmqService,
  ) {}

  get currentWorkerId(): string | null {
    return this.workerId
  }

  get currentIssueId(): number | null {
    return this.claimedIssueId
  }

  get currentStatus(): string {
    return this.workerStatus
  }

  async onApplicationBootstrap(): Promise<void> {
    const workerId = await this.register()

    this.startClaimPolling()
    this.startDispatchPolling()

    this.logger.log(`Worker ${workerId} started claim polling and dispatch polling loops`)
  }

  async onApplicationShutdown(): Promise<void> {
    this.isShuttingDown = true

    if (this.claimPollTimer) {
      clearInterval(this.claimPollTimer)
      this.claimPollTimer = null
    }
    if (this.dispatchPollTimer) {
      clearInterval(this.dispatchPollTimer)
      this.dispatchPollTimer = null
    }

    this.stopHeartbeat()

    const workerId = this.workerId
    const claimedIssueId = this.claimedIssueId
    this.workerId = null
    this.claimedIssueId = null
    this.workerStatus = HARNESS_WORKER_IDLE_STATUS

    if (claimedIssueId !== null) {
      const workspaceName = this.devpodService.getWorkspaceNameForIssue(claimedIssueId)

      try {
        await this.devpodService.deleteWorkspace(workspaceName)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.error(`Failed to delete DevPod workspace ${workspaceName} on shutdown: ${message}`)
      }
    }

    if (!workerId) {
      return
    }

    try {
      await this.prisma.client.harness_worker.delete({
        where: { id: workerId },
      })
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : null
      if (code === 'P2025') {
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Failed to delete worker row on shutdown: ${message}`)
    }
  }

  async register(): Promise<string> {
    if (this.workerId) {
      return this.workerId
    }

    const worker = await this.prisma.client.harness_worker.create({
      data: {
        devpod_metadata: Prisma.DbNull,
        issue_id: null,
        status: HARNESS_WORKER_IDLE_STATUS,
        last_updated_at: new Date(),
      },
    })

    this.workerId = worker.id
    this.startHeartbeat()
    this.logger.log(`Registered worker ${worker.id}`)

    return worker.id
  }

  async claimNextQueuedIssue(): Promise<WorkerClaim | null> {
    if (!this.workerId) {
      throw new Error('Cannot claim queued issues before worker registration')
    }

    const workerId = this.workerId
    const claim = await this.prisma.client.$transaction(async tx => {
      const now = new Date()

      const [candidate] = await tx.$queryRaw<Array<{ id: number; workspace_id: string }>>(Prisma.sql`
        SELECT issue.id, issue.workspace_id
        FROM issue
        INNER JOIN property_single_value status_value
          ON status_value.issue_id = issue.id
          AND status_value.property_id = ${SystemPropertyId.STATUS}
          AND status_value.value = ${HARNESS_WORKER_QUEUED_ISSUE_STATUS}
          AND status_value.deleted_at IS NULL
        INNER JOIN property_single_value assignee_value
          ON assignee_value.issue_id = issue.id
          AND assignee_value.property_id = ${SystemPropertyId.ASSIGNEE}
          AND assignee_value.value = ${SystemBotId.CODE_BOT}
          AND assignee_value.deleted_at IS NULL
        INNER JOIN property_single_value project_value
          ON project_value.issue_id = issue.id
          AND project_value.property_id = ${SystemPropertyId.PROJECT}
          AND project_value.value IS NOT NULL
          AND project_value.value <> ''
          AND project_value.deleted_at IS NULL
        LEFT JOIN property_single_value priority_value
          ON priority_value.issue_id = issue.id
          AND priority_value.property_id = ${SystemPropertyId.PRIORITY}
          AND priority_value.deleted_at IS NULL
        LEFT JOIN harness_workers worker
          ON worker.issue_id = issue.id
        WHERE issue.deleted_at IS NULL
          AND issue.workspace_id IS NOT NULL
          AND worker.issue_id IS NULL
        ORDER BY
          CASE priority_value.value
            WHEN 'urgent' THEN 0
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
            WHEN 'no-priority' THEN 4
            ELSE 5
          END ASC,
          issue.created_at ASC,
          issue.id ASC
        LIMIT 1
        FOR UPDATE OF issue SKIP LOCKED
      `)

      if (!candidate) {
        return null
      }

      const updateResult = await tx.harness_worker.updateMany({
        where: {
          id: workerId,
          issue_id: null,
        },
        data: {
          devpod_metadata: Prisma.DbNull,
          issue_id: candidate.id,
          status: HARNESS_WORKER_BUSY_STATUS,
          last_updated_at: now,
        },
      })

      if (updateResult.count !== 1) {
        return null
      }

      return {
        issueId: candidate.id,
        workspaceId: candidate.workspace_id,
      }
    })

    if (!claim) {
      return null
    }

    this.setClaimedIssueId(claim.issueId)
    return claim
  }

  async releaseClaim(): Promise<void> {
    if (!this.workerId) {
      throw new Error('Cannot release claim before worker registration')
    }

    await this.prisma.client.harness_worker.update({
      where: { id: this.workerId },
      data: {
        devpod_metadata: Prisma.DbNull,
        issue_id: null,
        status: HARNESS_WORKER_IDLE_STATUS,
        last_updated_at: new Date(),
      },
    })

    this.clearClaimedIssueId()
  }

  async heartbeat(): Promise<void> {
    if (this.isShuttingDown) {
      return
    }

    if (!this.workerId) {
      throw new Error('Cannot update heartbeat before worker registration')
    }

    try {
      await this.prisma.client.harness_worker.update({
        where: { id: this.workerId },
        data: {
          issue_id: this.claimedIssueId,
          status: this.workerStatus,
          last_updated_at: new Date(),
        },
      })
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : null
      if (code === 'P2025') {
        return
      }

      throw error
    }
  }

  private startClaimPolling(): void {
    if (this.claimPollTimer) {
      return
    }

    this.claimPollTimer = setInterval(() => {
      void this.runClaimPollingOnce().catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.error(`Worker claim poll failed: ${message}`)
      })
    }, this.pollIntervalMs)

    void this.runClaimPollingOnce().catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Initial worker claim poll failed: ${message}`)
    })
  }

  private startDispatchPolling(): void {
    if (this.dispatchPollTimer) {
      return
    }

    this.dispatchPollTimer = setInterval(() => {
      void this.runDispatchPollingOnce().catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.error(`Worker dispatch poll failed: ${message}`)
      })
    }, this.pollIntervalMs)

    void this.runDispatchPollingOnce().catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Initial worker dispatch poll failed: ${message}`)
    })
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.isShuttingDown) {
        return
      }

      void this.heartbeat().catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.error(`Failed to update worker heartbeat: ${message}`)
      })
    }, DEFAULT_HARNESS_WORKER_HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return
    }

    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private async runClaimPollingOnce(): Promise<void> {
    if (this.isClaimPolling) {
      return
    }
    this.isClaimPolling = true

    try {
      if (this.currentIssueId !== null) {
        return
      }

      const claim = await this.claimNextQueuedIssue()
      if (claim === null) {
        return
      }

      this.isProcessingClaimedIssue = true
      try {
        let promotedToPlanning = false
        try {
          const result = await this.issueService.updateIssue(
            {
              workspaceId: claim.workspaceId,
              userId: SystemBotId.CODE_BOT,
            },
            {
              issueId: claim.issueId,
              operations: [
                {
                  propertyId: SystemPropertyId.STATUS,
                  operationType: CommonPropertyOperationType.SET,
                  operationPayload: { value: HARNESS_WORKER_PLANNING_ISSUE_STATUS },
                },
              ],
            },
          )

          if (result.success) {
            promotedToPlanning = true
          } else {
            this.logger.error(
              `Failed to move claimed issue ${claim.issueId} to ${HARNESS_WORKER_PLANNING_ISSUE_STATUS}: ${(result.errors ?? ['Unknown error']).join(', ')}`,
            )
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.logger.error(
            `Failed to move claimed issue ${claim.issueId} to ${HARNESS_WORKER_PLANNING_ISSUE_STATUS}: ${message}`,
          )
        }

        if (!promotedToPlanning) {
          await this.releaseClaimAfterTransitionFailure(claim.issueId)
          return
        }

        this.logger.log(`Claimed queued issue ${claim.issueId} and moved it to ${HARNESS_WORKER_PLANNING_ISSUE_STATUS}`)
        try {
          await this.codingAgentSnapshotService.ensureIssueCodingAgentSnapshot(claim.issueId, claim.workspaceId)

          this.logger.log(`Planning pipeline for issue ${claim.issueId}: creating DevPod workspace`)
          const workspaceName = await this.devpodService.createWorkspaceForIssue(claim.issueId, claim.workspaceId)
          if (!workspaceName) {
            throw new Error('DevPod workspace setup did not complete successfully')
          }

          this.logger.log(
            `Planning pipeline for issue ${claim.issueId}: running coding agent planning in workspace ${workspaceName}`,
          )
          await this.codingAgentWorkflowService.startPlanning({
            issueId: claim.issueId,
            workspaceId: claim.workspaceId,
            workspaceName,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.logger.error(`Planning workflow failed for issue ${claim.issueId}: ${message}`)
        }
      } finally {
        this.isProcessingClaimedIssue = false
      }
    } finally {
      this.isClaimPolling = false
    }
  }

  private async runDispatchPollingOnce(): Promise<void> {
    if (this.isDispatchPolling || this.isProcessingClaimedIssue) {
      return
    }

    this.isDispatchPolling = true

    try {
      const issueId = this.currentIssueId
      if (issueId === null) {
        return
      }

      const queueName = getHarnessWorkerDispatchQueueName(issueId)
      const [message] = await this.pgmqService.read<HarnessWorkerIssueTrigger>(queueName, {
        batchSize: 1,
        visibilityTimeoutSeconds: this.dispatchVisibilityTimeoutSeconds,
      })

      if (!message) {
        return
      }

      try {
        this.isProcessingClaimedIssue = true
        try {
          if (message.message.trigger === 'release_claim') {
            await this.cleanupClaimedIssueWorkspace(issueId)
            await this.releaseClaim()
            this.logger.log(`Released worker claim for issue ${issueId} after receiving release trigger`)
          } else {
            const workspaceName = this.devpodService.getWorkspaceNameForIssue(issueId)

            switch (message.message.trigger) {
              case 'resume_planning':
                if (message.message.previousStatus === HARNESS_WORKER_PLAN_IN_REVIEW_ISSUE_STATUS) {
                  await this.codingAgentWorkflowService.requestPlanChanges({
                    issueId,
                    workspaceId: message.message.workspaceId,
                    workspaceName,
                  })
                } else {
                  await this.codingAgentWorkflowService.resumePlanning({
                    issueId,
                    workspaceId: message.message.workspaceId,
                    workspaceName,
                  })
                }
                break
              case 'approve_plan':
                await this.codingAgentWorkflowService.startImplementation({
                  issueId,
                  workspaceId: message.message.workspaceId,
                  workspaceName,
                })
                break
              case 'resume_implementation':
                await this.codingAgentWorkflowService.resumeImplementation({
                  issueId,
                  workspaceId: message.message.workspaceId,
                  workspaceName,
                })
                break
              case 'requested_code_changes':
                await this.codingAgentWorkflowService.applyRequestedCodeChanges({
                  issueId,
                  workspaceId: message.message.workspaceId,
                  workspaceName,
                })
                break
            }
          }
        } finally {
          this.isProcessingClaimedIssue = false
        }

        const archived = await this.pgmqService.archive(queueName, message.msg_id)
        if (!archived) {
          this.logger.warn(
            `Continuation trigger ${message.msg_id} for issue ${issueId} was not archived from ${queueName}`,
          )
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error)
        this.logger.error(`Failed to process continuation trigger for issue ${issueId}: ${messageText}`)
      }
    } finally {
      this.isDispatchPolling = false
    }
  }

  private async releaseClaimAfterTransitionFailure(issueId: number): Promise<void> {
    try {
      await this.releaseClaim()
      this.logger.warn(`Released worker claim for issue ${issueId} after planning transition failure`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Failed to release worker claim for issue ${issueId}: ${message}`)
    }
  }

  private async cleanupClaimedIssueWorkspace(issueId: number): Promise<void> {
    const workspaceName = this.devpodService.getWorkspaceNameForIssue(issueId)
    await this.devpodService.deleteWorkspace(workspaceName)
    await this.codingAgentSnapshotService.clearIssueCodingAgentSnapshot(issueId)
    this.logger.log(`Deleted DevPod workspace ${workspaceName} for issue ${issueId} after release trigger`)
  }

  private setClaimedIssueId(issueId: number): void {
    this.claimedIssueId = issueId
    this.workerStatus = HARNESS_WORKER_BUSY_STATUS
  }

  private clearClaimedIssueId(): void {
    this.claimedIssueId = null
    this.workerStatus = HARNESS_WORKER_IDLE_STATUS
  }
}
