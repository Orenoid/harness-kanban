import { ISSUE_EVENTS } from '@/event-bus/constants/event.constants'
import { IssueCreatedEvent, IssuePropertyChange, IssueUpdatedEvent } from '@/event-bus/types/event.types'
import { IssueService } from '@/issue/issue.service'
import { PgmqService } from '@/pgmq/pgmq.service'
import { SystemBotId } from '@/user/constants/user.constants'
import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { CommonPropertyOperationType, SystemPropertyId } from '@repo/shared/property/constants'
import {
  getHarnessWorkerDispatchQueueName,
  HARNESS_WORKER_CLAIMED_ISSUE_STATUSES,
  HARNESS_WORKER_IN_PROGRESS_ISSUE_STATUS,
  HARNESS_WORKER_IN_REVIEW_ISSUE_STATUS,
  HARNESS_WORKER_NEEDS_CLARIFICATION_ISSUE_STATUS,
  HARNESS_WORKER_NEEDS_HELP_ISSUE_STATUS,
  HARNESS_WORKER_PLAN_IN_REVIEW_ISSUE_STATUS,
  HARNESS_WORKER_PLANNING_ISSUE_STATUS,
  HARNESS_WORKER_PLANNING_NEEDS_HELP_ISSUE_STATUS,
  HARNESS_WORKER_QUEUED_ISSUE_STATUS,
  HARNESS_WORKER_TERMINAL_ISSUE_STATUSES,
} from '../../worker/worker.constants'
import { HarnessWorkerIssueTrigger, HarnessWorkerIssueTriggerType } from '../../worker/worker.types'
import { TODO_STATUS_ID } from '../constants/code-bot.constants'

type IssueState = {
  assigneeId: string | null
  statusId: string | null
}

@Injectable()
export class CodeBotAutoQueueListener {
  private readonly logger = new Logger(CodeBotAutoQueueListener.name)

  constructor(private readonly issueService: IssueService) {}

  // Automatically queues freshly assigned Code Bot issues when they are still in Todo.
  @OnEvent(ISSUE_EVENTS.ISSUE_CREATED)
  async handleIssueCreated(event: IssueCreatedEvent): Promise<void> {
    const issueStates = await this.issueService.getIssueStates(event.issues.map(issue => issue.issueId))

    for (const issue of event.issues) {
      const issueState = issueStates.get(issue.issueId)
      if (!issueState) {
        continue
      }

      await this.queueIssueIfNeeded(issue.workspaceId, issue.issueId, issueState)
    }
  }

  @OnEvent(ISSUE_EVENTS.ISSUE_UPDATED)
  async handleIssueUpdated(event: IssueUpdatedEvent): Promise<void> {
    if (!event.updatedPropertyIds.includes(SystemPropertyId.ASSIGNEE)) {
      return
    }

    const issueState = (await this.issueService.getIssueStates([event.issueId])).get(event.issueId)
    if (!issueState) {
      return
    }

    await this.queueIssueIfNeeded(event.workspaceId, event.issueId, issueState)
  }

  private async queueIssueIfNeeded(workspaceId: string, issueId: number, issueState: IssueState): Promise<void> {
    if (issueState.assigneeId !== SystemBotId.CODE_BOT) {
      return
    }

    if (issueState.statusId === HARNESS_WORKER_QUEUED_ISSUE_STATUS) {
      return
    }

    if (issueState.statusId !== TODO_STATUS_ID) {
      return
    }

    const result = await this.issueService.updateIssue(
      {
        workspaceId,
        userId: SystemBotId.CODE_BOT,
      },
      {
        issueId,
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: HARNESS_WORKER_QUEUED_ISSUE_STATUS },
          },
        ],
      },
    )

    if (!result.success) {
      this.logger.error(
        `Failed to auto-queue Code Bot issue ${issueId}: ${(result.errors ?? ['Unknown error']).join(', ')}`,
      )
    }
  }
}

@Injectable()
export class CodeBotIssueTriggerListener {
  // Publishes worker continuation triggers after humans move a Code Bot issue through review states.
  private readonly logger = new Logger(CodeBotIssueTriggerListener.name)

  constructor(
    private readonly issueService: IssueService,
    private readonly pgmqService: PgmqService,
  ) {}

  @OnEvent(ISSUE_EVENTS.ISSUE_UPDATED)
  async handleIssueUpdated(event: IssueUpdatedEvent): Promise<void> {
    const statusChange = event.propertyChanges.find(change => change.propertyId === SystemPropertyId.STATUS)
    if (!statusChange) {
      return
    }

    const trigger = this.resolveTrigger(statusChange)
    if (!trigger) {
      return
    }

    if (trigger === 'release_claim') {
      await this.publishTrigger(event, statusChange, trigger)
      return
    }

    if (event.userId === SystemBotId.CODE_BOT) {
      return
    }

    const assigneeResult = await this.issueService.updateIssue(
      {
        workspaceId: event.workspaceId,
        userId: SystemBotId.CODE_BOT,
      },
      {
        issueId: event.issueId,
        operations: [
          {
            propertyId: SystemPropertyId.ASSIGNEE,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: SystemBotId.CODE_BOT },
          },
        ],
      },
    )

    if (!assigneeResult.success) {
      this.logger.error(
        `Failed to reassign issue ${event.issueId} to Code Bot before publishing ${trigger}: ${(assigneeResult.errors ?? ['Unknown error']).join(', ')}`,
      )
      return
    }

    await this.publishTrigger(event, statusChange, trigger)
  }

  private async publishTrigger(
    event: IssueUpdatedEvent,
    statusChange: IssuePropertyChange,
    trigger: HarnessWorkerIssueTriggerType,
  ): Promise<void> {
    const previousStatus = this.toStatusId(statusChange.previousValue)
    const nextStatus = this.toStatusId(statusChange.newValue)
    if (!previousStatus || !nextStatus) {
      return
    }

    const payload: HarnessWorkerIssueTrigger = {
      issueId: event.issueId,
      workspaceId: event.workspaceId,
      trigger,
      previousStatus,
      nextStatus,
      requestedAt: new Date().toISOString(),
      requestedBy: event.userId,
    }

    const queueName = getHarnessWorkerDispatchQueueName(event.issueId)
    const messageId = await this.pgmqService.send(queueName, payload)
    this.logger.log(`Published ${trigger} trigger for issue ${event.issueId} to ${queueName} as message ${messageId}`)
  }

  private resolveTrigger(change: IssuePropertyChange): HarnessWorkerIssueTriggerType | null {
    const previousStatus = this.toStatusId(change.previousValue)
    const nextStatus = this.toStatusId(change.newValue)

    if (!previousStatus || !nextStatus) {
      return null
    }

    if (
      previousStatus === HARNESS_WORKER_NEEDS_CLARIFICATION_ISSUE_STATUS &&
      nextStatus === HARNESS_WORKER_PLANNING_ISSUE_STATUS
    ) {
      return 'resume_planning'
    }

    if (
      previousStatus === HARNESS_WORKER_PLANNING_NEEDS_HELP_ISSUE_STATUS &&
      nextStatus === HARNESS_WORKER_PLANNING_ISSUE_STATUS
    ) {
      return 'resume_planning'
    }

    if (
      previousStatus === HARNESS_WORKER_PLAN_IN_REVIEW_ISSUE_STATUS &&
      nextStatus === HARNESS_WORKER_PLANNING_ISSUE_STATUS
    ) {
      return 'resume_planning'
    }

    if (
      previousStatus === HARNESS_WORKER_PLAN_IN_REVIEW_ISSUE_STATUS &&
      nextStatus === HARNESS_WORKER_IN_PROGRESS_ISSUE_STATUS
    ) {
      return 'approve_plan'
    }

    if (
      previousStatus === HARNESS_WORKER_NEEDS_HELP_ISSUE_STATUS &&
      nextStatus === HARNESS_WORKER_IN_PROGRESS_ISSUE_STATUS
    ) {
      return 'resume_implementation'
    }

    if (
      previousStatus === HARNESS_WORKER_IN_REVIEW_ISSUE_STATUS &&
      nextStatus === HARNESS_WORKER_IN_PROGRESS_ISSUE_STATUS
    ) {
      return 'requested_code_changes'
    }

    if (
      HARNESS_WORKER_CLAIMED_ISSUE_STATUSES.includes(
        previousStatus as (typeof HARNESS_WORKER_CLAIMED_ISSUE_STATUSES)[number],
      ) &&
      HARNESS_WORKER_TERMINAL_ISSUE_STATUSES.includes(
        nextStatus as (typeof HARNESS_WORKER_TERMINAL_ISSUE_STATUSES)[number],
      )
    ) {
      return 'release_claim'
    }

    return null
  }

  private toStatusId(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }
}
