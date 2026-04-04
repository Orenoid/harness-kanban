import { SystemBotId } from '@/user/constants/user.constants'
import { SystemPropertyId } from '@repo/shared/property/constants'
import {
  CANCELED_STATUS_ID,
  CODE_BOT_ASSIGNMENT_ERROR,
  CODE_BOT_CODING_AGENT_CONFIGURATION_ERROR,
  CODE_BOT_REASSIGNMENT_ERROR,
  CODE_BOT_STATUS_ERROR,
  TODO_STATUS_ID,
} from '../constants/code-bot.constants'
import { CodeBotAssigneeHook, CodeBotCreateHook, CodeBotStatusHook } from '../hooks/issue-code-bot.hooks'

describe('Code Bot hooks', () => {
  let createHook: CodeBotCreateHook
  let assigneeHook: CodeBotAssigneeHook
  let statusHook: CodeBotStatusHook
  let hasCodingAgentConfiguredMock: jest.Mock

  beforeEach(() => {
    hasCodingAgentConfiguredMock = jest.fn().mockResolvedValue(true)

    const codingAgentService = {
      hasCodingAgentConfigured: hasCodingAgentConfiguredMock,
    } as any

    createHook = new CodeBotCreateHook(codingAgentService)
    assigneeHook = new CodeBotAssigneeHook(codingAgentService)
    statusHook = new CodeBotStatusHook()
  })

  it('allows create when Code Bot is assigned with Todo status', async () => {
    await expect(
      createHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        propertyMap: [],
        propertyValues: [],
        getRequestedValue: propertyId =>
          ({
            [SystemPropertyId.ASSIGNEE]: SystemBotId.CODE_BOT,
            [SystemPropertyId.STATUS]: TODO_STATUS_ID,
          })[propertyId],
      }),
    ).resolves.toEqual({ valid: true })

    expect(hasCodingAgentConfiguredMock).toHaveBeenCalledWith('codex')
  })

  it('rejects create when Code Bot is assigned with a non-Todo status', async () => {
    await expect(
      createHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        propertyMap: [],
        propertyValues: [],
        getRequestedValue: propertyId =>
          ({
            [SystemPropertyId.ASSIGNEE]: SystemBotId.CODE_BOT,
            [SystemPropertyId.STATUS]: 'in_progress',
          })[propertyId],
      }),
    ).resolves.toEqual({
      valid: false,
      errors: [CODE_BOT_ASSIGNMENT_ERROR],
    })

    expect(hasCodingAgentConfiguredMock).not.toHaveBeenCalled()
  })

  it('rejects create when Code Bot is assigned without any coding agent configuration', async () => {
    hasCodingAgentConfiguredMock.mockResolvedValue(false)

    await expect(
      createHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        propertyMap: [],
        propertyValues: [],
        getRequestedValue: propertyId =>
          ({
            [SystemPropertyId.ASSIGNEE]: SystemBotId.CODE_BOT,
            [SystemPropertyId.STATUS]: TODO_STATUS_ID,
          })[propertyId],
      }),
    ).resolves.toEqual({
      valid: false,
      errors: [CODE_BOT_CODING_AGENT_CONFIGURATION_ERROR],
    })
  })

  it('allows assigning Code Bot when the current issue status is Todo', async () => {
    await expect(
      assigneeHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        issueId: 1,
        issue: { id: 1, workspace_id: 'workspace-1' },
        operations: [],
        propertyMap: [],
        originalPropertyValues: new Map([[SystemPropertyId.STATUS, TODO_STATUS_ID]]),
        getCurrentValue: propertyId => (propertyId === SystemPropertyId.STATUS ? TODO_STATUS_ID : null),
        getOperation: () => undefined,
        getNextSetValue: propertyId => (propertyId === SystemPropertyId.ASSIGNEE ? SystemBotId.CODE_BOT : undefined),
      }),
    ).resolves.toEqual({ valid: true })

    expect(hasCodingAgentConfiguredMock).toHaveBeenCalledWith('codex')
  })

  it('rejects assigning Code Bot when the current issue status is Queued', async () => {
    await expect(
      assigneeHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        issueId: 1,
        issue: { id: 1, workspace_id: 'workspace-1' },
        operations: [],
        propertyMap: [],
        originalPropertyValues: new Map([[SystemPropertyId.STATUS, 'queued']]),
        getCurrentValue: propertyId => (propertyId === SystemPropertyId.STATUS ? 'queued' : null),
        getOperation: () => undefined,
        getNextSetValue: propertyId => (propertyId === SystemPropertyId.ASSIGNEE ? SystemBotId.CODE_BOT : undefined),
      }),
    ).resolves.toEqual({
      valid: false,
      errors: [CODE_BOT_REASSIGNMENT_ERROR],
    })

    expect(hasCodingAgentConfiguredMock).not.toHaveBeenCalled()
  })

  it('allows reassigning Code Bot when the current issue status is Planning', async () => {
    await expect(
      assigneeHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        issueId: 1,
        issue: { id: 1, workspace_id: 'workspace-1' },
        operations: [],
        propertyMap: [],
        originalPropertyValues: new Map([[SystemPropertyId.STATUS, 'planning']]),
        getCurrentValue: propertyId => (propertyId === SystemPropertyId.STATUS ? 'planning' : null),
        getOperation: () => undefined,
        getNextSetValue: propertyId => (propertyId === SystemPropertyId.ASSIGNEE ? SystemBotId.CODE_BOT : undefined),
      }),
    ).resolves.toEqual({ valid: true })
  })

  it('rejects assigning Code Bot when no coding agent configuration exists', async () => {
    hasCodingAgentConfiguredMock.mockResolvedValue(false)

    await expect(
      assigneeHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        issueId: 1,
        issue: { id: 1, workspace_id: 'workspace-1' },
        operations: [],
        propertyMap: [],
        originalPropertyValues: new Map([[SystemPropertyId.STATUS, TODO_STATUS_ID]]),
        getCurrentValue: propertyId => (propertyId === SystemPropertyId.STATUS ? TODO_STATUS_ID : null),
        getOperation: () => undefined,
        getNextSetValue: propertyId => (propertyId === SystemPropertyId.ASSIGNEE ? SystemBotId.CODE_BOT : undefined),
      }),
    ).resolves.toEqual({
      valid: false,
      errors: [CODE_BOT_CODING_AGENT_CONFIGURATION_ERROR],
    })
  })

  it('allows reassigning Code Bot when the current issue status is In Progress', async () => {
    await expect(
      assigneeHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        issueId: 1,
        issue: { id: 1, workspace_id: 'workspace-1' },
        operations: [],
        propertyMap: [],
        originalPropertyValues: new Map([[SystemPropertyId.STATUS, 'in_progress']]),
        getCurrentValue: propertyId => (propertyId === SystemPropertyId.STATUS ? 'in_progress' : null),
        getOperation: () => undefined,
        getNextSetValue: propertyId => (propertyId === SystemPropertyId.ASSIGNEE ? SystemBotId.CODE_BOT : undefined),
      }),
    ).resolves.toEqual({ valid: true })
  })

  it('rejects reassigning Code Bot when the current issue status is Plan in Review', async () => {
    await expect(
      assigneeHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        issueId: 1,
        issue: { id: 1, workspace_id: 'workspace-1' },
        operations: [],
        propertyMap: [],
        originalPropertyValues: new Map([[SystemPropertyId.STATUS, 'plan_in_review']]),
        getCurrentValue: propertyId => (propertyId === SystemPropertyId.STATUS ? 'plan_in_review' : null),
        getOperation: () => undefined,
        getNextSetValue: propertyId => (propertyId === SystemPropertyId.ASSIGNEE ? SystemBotId.CODE_BOT : undefined),
      }),
    ).resolves.toEqual({
      valid: false,
      errors: [CODE_BOT_REASSIGNMENT_ERROR],
    })
  })

  it('allows moving a Code Bot issue to Canceled', async () => {
    await expect(
      statusHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        issueId: 1,
        issue: { id: 1, workspace_id: 'workspace-1' },
        operations: [],
        propertyMap: [],
        originalPropertyValues: new Map([[SystemPropertyId.ASSIGNEE, SystemBotId.CODE_BOT]]),
        getCurrentValue: propertyId => (propertyId === SystemPropertyId.ASSIGNEE ? SystemBotId.CODE_BOT : null),
        getOperation: () => undefined,
        getNextSetValue: propertyId => (propertyId === SystemPropertyId.STATUS ? CANCELED_STATUS_ID : undefined),
      }),
    ).resolves.toEqual({ valid: true })
  })

  it('allows Code Bot itself to move its issue to Queued', async () => {
    await expect(
      statusHook.execute({
        workspaceId: 'workspace-1',
        userId: SystemBotId.CODE_BOT,
        issueId: 1,
        issue: { id: 1, workspace_id: 'workspace-1' },
        operations: [],
        propertyMap: [],
        originalPropertyValues: new Map([
          [SystemPropertyId.ASSIGNEE, SystemBotId.CODE_BOT],
          [SystemPropertyId.STATUS, TODO_STATUS_ID],
        ]),
        getCurrentValue: propertyId => {
          if (propertyId === SystemPropertyId.ASSIGNEE) {
            return SystemBotId.CODE_BOT
          }

          if (propertyId === SystemPropertyId.STATUS) {
            return TODO_STATUS_ID
          }

          return null
        },
        getOperation: () => undefined,
        getNextSetValue: propertyId => (propertyId === SystemPropertyId.STATUS ? 'queued' : undefined),
      }),
    ).resolves.toEqual({ valid: true })
  })

  it('allows Code Bot itself to move its issue to follow-up statuses', async () => {
    await expect(
      statusHook.execute({
        workspaceId: 'workspace-1',
        userId: SystemBotId.CODE_BOT,
        issueId: 1,
        issue: { id: 1, workspace_id: 'workspace-1' },
        operations: [],
        propertyMap: [],
        originalPropertyValues: new Map([
          [SystemPropertyId.ASSIGNEE, SystemBotId.CODE_BOT],
          [SystemPropertyId.STATUS, 'queued'],
        ]),
        getCurrentValue: propertyId => {
          if (propertyId === SystemPropertyId.ASSIGNEE) {
            return SystemBotId.CODE_BOT
          }

          if (propertyId === SystemPropertyId.STATUS) {
            return 'queued'
          }

          return null
        },
        getOperation: () => undefined,
        getNextSetValue: propertyId => (propertyId === SystemPropertyId.STATUS ? 'planning' : undefined),
      }),
    ).resolves.toEqual({ valid: true })
  })

  it('rejects human non-canceled status moves while Code Bot is the current assignee', async () => {
    await expect(
      statusHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        issueId: 1,
        issue: { id: 1, workspace_id: 'workspace-1' },
        operations: [],
        propertyMap: [],
        originalPropertyValues: new Map([[SystemPropertyId.ASSIGNEE, SystemBotId.CODE_BOT]]),
        getCurrentValue: propertyId => (propertyId === SystemPropertyId.ASSIGNEE ? SystemBotId.CODE_BOT : null),
        getOperation: () => undefined,
        getNextSetValue: propertyId => (propertyId === SystemPropertyId.STATUS ? 'in_progress' : undefined),
      }),
    ).resolves.toEqual({
      valid: false,
      errors: [CODE_BOT_STATUS_ERROR],
    })
  })

  it('ignores status updates for issues assigned to other users', async () => {
    await expect(
      statusHook.execute({
        workspaceId: 'workspace-1',
        userId: 'user-1',
        issueId: 1,
        issue: { id: 1, workspace_id: 'workspace-1' },
        operations: [],
        propertyMap: [],
        originalPropertyValues: new Map([[SystemPropertyId.ASSIGNEE, 'user-2']]),
        getCurrentValue: propertyId => (propertyId === SystemPropertyId.ASSIGNEE ? 'user-2' : null),
        getOperation: () => undefined,
        getNextSetValue: propertyId => (propertyId === SystemPropertyId.STATUS ? 'in_progress' : undefined),
      }),
    ).resolves.toEqual({ valid: true })
  })
})
