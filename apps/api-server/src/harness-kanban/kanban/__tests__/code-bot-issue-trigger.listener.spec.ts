import { IssueUpdatedEvent } from '@/event-bus/types/event.types'
import { IssueService } from '@/issue/issue.service'
import { PgmqService } from '@/pgmq/pgmq.service'
import { SystemBotId } from '@/user/constants/user.constants'
import { CommonPropertyOperationType, SystemPropertyId } from '@repo/shared/property/constants'
import { CODE_BOT_CODING_AGENT_CONFIGURATION_ERROR } from '../constants/code-bot.constants'
import { CodeBotIssueTriggerListener } from '../listeners/issue-code-bot.listeners'

describe('CodeBotIssueTriggerListener', () => {
  let listener: CodeBotIssueTriggerListener
  let updateIssueMock: jest.Mock
  let sendMock: jest.Mock

  beforeEach(() => {
    updateIssueMock = jest.fn().mockResolvedValue({
      success: true,
      issueId: 101,
    })
    sendMock = jest.fn().mockResolvedValue(17)

    const issueService = {
      updateIssue: updateIssueMock,
    } as unknown as jest.Mocked<IssueService>

    const pgmqService = {
      send: sendMock,
    } as unknown as jest.Mocked<PgmqService>

    listener = new CodeBotIssueTriggerListener(issueService, pgmqService)
  })

  it('publishes resume_planning when plan review is sent back to planning', async () => {
    const event: IssueUpdatedEvent = {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      issueId: 101,
      updatedPropertyIds: [SystemPropertyId.STATUS],
      propertyChanges: [
        {
          propertyId: SystemPropertyId.STATUS,
          previousValue: 'plan_in_review',
          newValue: 'planning',
        },
      ],
    }

    await listener.handleIssueUpdated(event)

    expect(updateIssueMock).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        userId: SystemBotId.CODE_BOT,
      },
      {
        issueId: 101,
        operations: [
          {
            propertyId: SystemPropertyId.ASSIGNEE,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: SystemBotId.CODE_BOT },
          },
        ],
      },
    )
    expect(sendMock).toHaveBeenCalledWith('harness_issue_dispatch_101', {
      issueId: 101,
      workspaceId: 'workspace-1',
      trigger: 'resume_planning',
      previousStatus: 'plan_in_review',
      nextStatus: 'planning',
      requestedAt: expect.any(String),
      requestedBy: 'user-1',
    })
  })

  it('publishes approve_plan when a plan is approved', async () => {
    await listener.handleIssueUpdated({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      issueId: 101,
      updatedPropertyIds: [SystemPropertyId.STATUS],
      propertyChanges: [
        {
          propertyId: SystemPropertyId.STATUS,
          previousValue: 'plan_in_review',
          newValue: 'in_progress',
        },
      ],
    })

    expect(sendMock).toHaveBeenCalledWith(
      'harness_issue_dispatch_101',
      expect.objectContaining({
        trigger: 'approve_plan',
        previousStatus: 'plan_in_review',
        nextStatus: 'in_progress',
      }),
    )
  })

  it('publishes release_claim when a claimed issue reaches a terminal status', async () => {
    await listener.handleIssueUpdated({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      issueId: 101,
      updatedPropertyIds: [SystemPropertyId.STATUS],
      propertyChanges: [
        {
          propertyId: SystemPropertyId.STATUS,
          previousValue: 'in_review',
          newValue: 'completed',
        },
      ],
    })

    expect(updateIssueMock).not.toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledWith(
      'harness_issue_dispatch_101',
      expect.objectContaining({
        trigger: 'release_claim',
        previousStatus: 'in_review',
        nextStatus: 'completed',
      }),
    )
  })

  it('publishes release_claim even when the terminal transition is initiated by Code Bot', async () => {
    await listener.handleIssueUpdated({
      workspaceId: 'workspace-1',
      userId: SystemBotId.CODE_BOT,
      issueId: 101,
      updatedPropertyIds: [SystemPropertyId.STATUS],
      propertyChanges: [
        {
          propertyId: SystemPropertyId.STATUS,
          previousValue: 'needs_help',
          newValue: 'canceled',
        },
      ],
    })

    expect(updateIssueMock).not.toHaveBeenCalled()
    expect(sendMock).toHaveBeenCalledWith(
      'harness_issue_dispatch_101',
      expect.objectContaining({
        trigger: 'release_claim',
        previousStatus: 'needs_help',
        nextStatus: 'canceled',
      }),
    )
  })

  it('ignores non-terminal transitions initiated by Code Bot itself', async () => {
    await listener.handleIssueUpdated({
      workspaceId: 'workspace-1',
      userId: SystemBotId.CODE_BOT,
      issueId: 101,
      updatedPropertyIds: [SystemPropertyId.STATUS],
      propertyChanges: [
        {
          propertyId: SystemPropertyId.STATUS,
          previousValue: 'plan_in_review',
          newValue: 'planning',
        },
      ],
    })

    expect(updateIssueMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('ignores unsupported status transitions', async () => {
    await listener.handleIssueUpdated({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      issueId: 101,
      updatedPropertyIds: [SystemPropertyId.STATUS],
      propertyChanges: [
        {
          propertyId: SystemPropertyId.STATUS,
          previousValue: 'planning',
          newValue: 'plan_in_review',
        },
      ],
    })

    expect(updateIssueMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('does not publish a trigger when reassignment back to Code Bot is rejected', async () => {
    updateIssueMock.mockResolvedValueOnce({
      success: false,
      errors: [CODE_BOT_CODING_AGENT_CONFIGURATION_ERROR],
    })

    await listener.handleIssueUpdated({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      issueId: 101,
      updatedPropertyIds: [SystemPropertyId.STATUS],
      propertyChanges: [
        {
          propertyId: SystemPropertyId.STATUS,
          previousValue: 'plan_in_review',
          newValue: 'planning',
        },
      ],
    })

    expect(updateIssueMock).toHaveBeenCalledTimes(1)
    expect(sendMock).not.toHaveBeenCalled()
  })
})
