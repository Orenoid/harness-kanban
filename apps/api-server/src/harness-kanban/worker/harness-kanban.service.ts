import { CodingAgentService } from '@/coding-agent/coding-agent.service'
import { IssueService } from '@/issue/issue.service'
import { PgmqService } from '@/pgmq/pgmq.service'
import { SystemBotId } from '@/user/constants/user.constants'
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common'
import { CommonPropertyOperationType, SystemPropertyId } from '@repo/shared/property/constants'
import { HarnessWorkerCodexWorkflowService } from './harness-worker-codex-workflow.service'
import { HarnessWorkerDevpodService } from './harness-worker-devpod.service'
import { HarnessWorkerRegistryService } from './harness-worker-registry.service'
import { HarnessWorkerIssueTrigger } from './harness-worker-trigger.types'
import {
  DEFAULT_HARNESS_WORKER_DISPATCH_VISIBILITY_TIMEOUT_SECONDS,
  DEFAULT_HARNESS_WORKER_POLL_INTERVAL_MS,
  getHarnessWorkerDispatchQueueName,
  HARNESS_WORKER_PLAN_IN_REVIEW_ISSUE_STATUS,
  HARNESS_WORKER_PLANNING_ISSUE_STATUS,
} from './harness-worker.constants'

@Injectable()
export class HarnessKanbanService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HarnessKanbanService.name)
  private readonly pollIntervalMs = DEFAULT_HARNESS_WORKER_POLL_INTERVAL_MS
  private readonly dispatchVisibilityTimeoutSeconds = DEFAULT_HARNESS_WORKER_DISPATCH_VISIBILITY_TIMEOUT_SECONDS
  private claimPollTimer: NodeJS.Timeout | null = null
  private dispatchPollTimer: NodeJS.Timeout | null = null
  private isClaimPolling = false
  private isDispatchPolling = false
  private isProcessingClaimedIssue = false

  constructor(
    private readonly registryService: HarnessWorkerRegistryService,
    private readonly codingAgentService: CodingAgentService,
    private readonly issueService: IssueService,
    private readonly pgmqService: PgmqService,
    private readonly devpodService: HarnessWorkerDevpodService,
    private readonly codexWorkflowService: HarnessWorkerCodexWorkflowService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const workerId = await this.registryService.register()

    this.startClaimPolling()
    this.startDispatchPolling()

    this.logger.log(`Worker ${workerId} started claim polling and dispatch polling loops`)
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.claimPollTimer) {
      clearInterval(this.claimPollTimer)
      this.claimPollTimer = null
    }
    if (this.dispatchPollTimer) {
      clearInterval(this.dispatchPollTimer)
      this.dispatchPollTimer = null
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

  private async runClaimPollingOnce(): Promise<void> {
    if (this.isClaimPolling) {
      return
    }
    this.isClaimPolling = true

    try {
      if (this.registryService.currentIssueId !== null) {
        return
      }

      const claim = await this.registryService.claimNextQueuedIssue()
      if (claim === null) {
        return
      }

      this.isProcessingClaimedIssue = true
      try {
        let promotedToPlanning = false
        try {
          // Move the claimed issue into planning before any long-running workspace work starts.
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
          await this.codingAgentService.ensureIssueCodingAgentSnapshot(claim.issueId, 'codex')

          this.logger.log(`Planning pipeline for issue ${claim.issueId}: creating DevPod workspace`)
          const workspaceName = await this.devpodService.createWorkspaceForIssue(claim.issueId, claim.workspaceId)
          if (!workspaceName) {
            throw new Error('DevPod workspace setup did not complete successfully')
          }

          this.logger.log(
            `Planning pipeline for issue ${claim.issueId}: running Codex planning in workspace ${workspaceName}`,
          )
          await this.codexWorkflowService.startPlanning({
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
      const issueId = this.registryService.currentIssueId
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
            await this.registryService.releaseClaim()
            this.logger.log(`Released worker claim for issue ${issueId} after receiving release trigger`)
          } else {
            const workspaceName = this.devpodService.getWorkspaceNameForIssue(issueId)

            switch (message.message.trigger) {
              case 'resume_planning':
                if (message.message.previousStatus === HARNESS_WORKER_PLAN_IN_REVIEW_ISSUE_STATUS) {
                  await this.codexWorkflowService.requestPlanChanges({
                    issueId,
                    workspaceId: message.message.workspaceId,
                    workspaceName,
                  })
                } else {
                  await this.codexWorkflowService.resumePlanning({
                    issueId,
                    workspaceId: message.message.workspaceId,
                    workspaceName,
                  })
                }
                break
              case 'approve_plan':
                await this.codexWorkflowService.startImplementation({
                  issueId,
                  workspaceId: message.message.workspaceId,
                  workspaceName,
                })
                break
              case 'resume_implementation':
                await this.codexWorkflowService.resumeImplementation({
                  issueId,
                  workspaceId: message.message.workspaceId,
                  workspaceName,
                })
                break
              case 'requested_code_changes':
                await this.codexWorkflowService.applyRequestedCodeChanges({
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
      await this.registryService.releaseClaim()
      this.logger.warn(`Released worker claim for issue ${issueId} after planning transition failure`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Failed to release worker claim for issue ${issueId}: ${message}`)
    }
  }

  private async cleanupClaimedIssueWorkspace(issueId: number): Promise<void> {
    const workspaceName = this.devpodService.getWorkspaceNameForIssue(issueId)
    await this.devpodService.deleteWorkspace(workspaceName)
    await this.codingAgentService.clearIssueCodingAgentSnapshot(issueId)
    this.logger.log(`Deleted DevPod workspace ${workspaceName} for issue ${issueId} after release trigger`)
  }
}
