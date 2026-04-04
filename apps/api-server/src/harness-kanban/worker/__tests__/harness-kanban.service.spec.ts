import { CodingAgentService } from '@/coding-agent/coding-agent.service'
import { IssueService } from '@/issue/issue.service'
import { PgmqService } from '@/pgmq/pgmq.service'
import { SystemBotId } from '@/user/constants/user.constants'
import { CommonPropertyOperationType, SystemPropertyId } from '@repo/shared/property/constants'
import { HarnessKanbanService } from '../harness-kanban.service'
import { HarnessWorkerCodexWorkflowService } from '../harness-worker-codex-workflow.service'
import { HarnessWorkerDevpodService } from '../harness-worker-devpod.service'
import { HarnessWorkerRegistryService } from '../harness-worker-registry.service'

describe('HarnessKanbanService', () => {
  let service: HarnessKanbanService
  let registryService: jest.Mocked<HarnessWorkerRegistryService>
  let codingAgentService: jest.Mocked<CodingAgentService>
  let issueService: jest.Mocked<IssueService>
  let pgmqService: jest.Mocked<PgmqService>
  let devpodService: jest.Mocked<HarnessWorkerDevpodService>
  let codexWorkflowService: jest.Mocked<HarnessWorkerCodexWorkflowService>
  let readQueueMock: jest.Mock
  let archiveMessageMock: jest.Mock

  beforeEach(() => {
    registryService = {
      currentWorkerId: 'worker-1',
      currentIssueId: null,
      register: jest.fn(),
      claimNextQueuedIssue: jest.fn(),
      releaseClaim: jest.fn(),
    } as unknown as jest.Mocked<HarnessWorkerRegistryService>

    codingAgentService = {
      ensureIssueCodingAgentSnapshot: jest.fn().mockResolvedValue({
        id: 'snapshot-1',
        name: 'Primary Codex',
        type: 'codex',
        settings: {
          authMode: 'api-key',
          apiKey: 'sk-test-123',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'medium',
        },
        isDefault: true,
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      }),
      clearIssueCodingAgentSnapshot: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CodingAgentService>

    issueService = {
      updateIssue: jest.fn(),
    } as unknown as jest.Mocked<IssueService>

    readQueueMock = jest.fn().mockResolvedValue([])
    archiveMessageMock = jest.fn().mockResolvedValue(true)
    pgmqService = {
      read: readQueueMock,
      archive: archiveMessageMock,
    } as unknown as jest.Mocked<PgmqService>

    devpodService = {
      createWorkspaceForIssue: jest.fn(),
      deleteWorkspace: jest.fn(),
      getWorkspaceNameForIssue: jest.fn(),
    } as unknown as jest.Mocked<HarnessWorkerDevpodService>

    codexWorkflowService = {
      startPlanning: jest.fn(),
      resumePlanning: jest.fn(),
      requestPlanChanges: jest.fn(),
      startImplementation: jest.fn(),
      resumeImplementation: jest.fn(),
      applyRequestedCodeChanges: jest.fn(),
    } as unknown as jest.Mocked<HarnessWorkerCodexWorkflowService>

    service = new HarnessKanbanService(
      registryService,
      codingAgentService,
      issueService,
      pgmqService,
      devpodService,
      codexWorkflowService,
    )
  })

  it('moves a claimed Code Bot issue to planning, creates the workspace, and starts planning workflow', async () => {
    registryService.claimNextQueuedIssue.mockResolvedValue({
      issueId: 101,
      workspaceId: 'workspace-1',
    })
    issueService.updateIssue.mockResolvedValue({
      success: true,
      issueId: 101,
    })
    devpodService.createWorkspaceForIssue.mockResolvedValue('harness-kanban-issue-101')

    await (service as unknown as { runClaimPollingOnce(): Promise<void> }).runClaimPollingOnce()

    expect(registryService.claimNextQueuedIssue).toHaveBeenCalledTimes(1)
    expect(issueService.updateIssue).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        userId: SystemBotId.CODE_BOT,
      },
      {
        issueId: 101,
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'planning' },
          },
        ],
      },
    )
    expect(devpodService.createWorkspaceForIssue).toHaveBeenCalledWith(101, 'workspace-1')
    expect(codingAgentService.ensureIssueCodingAgentSnapshot).toHaveBeenCalledWith(101, 'codex')
    expect(codexWorkflowService.startPlanning).toHaveBeenCalledWith({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })
    expect(registryService.releaseClaim).not.toHaveBeenCalled()
  })

  it('releases the claim when the planning transition fails', async () => {
    registryService.claimNextQueuedIssue.mockResolvedValue({
      issueId: 303,
      workspaceId: 'workspace-1',
    })
    issueService.updateIssue.mockResolvedValue({
      success: false,
      errors: ['transition failed'],
    })

    await (service as unknown as { runClaimPollingOnce(): Promise<void> }).runClaimPollingOnce()

    expect(registryService.releaseClaim).toHaveBeenCalledTimes(1)
    expect(devpodService.createWorkspaceForIssue).not.toHaveBeenCalled()
    expect(codexWorkflowService.startPlanning).not.toHaveBeenCalled()
  })

  it('does not start planning when the coding agent snapshot cannot be created', async () => {
    registryService.claimNextQueuedIssue.mockResolvedValue({
      issueId: 404,
      workspaceId: 'workspace-1',
    })
    issueService.updateIssue.mockResolvedValue({
      success: true,
      issueId: 404,
    })
    codingAgentService.ensureIssueCodingAgentSnapshot.mockRejectedValue(
      new Error('No coding agent is configured for type "codex".'),
    )

    await (service as unknown as { runClaimPollingOnce(): Promise<void> }).runClaimPollingOnce()

    expect(devpodService.createWorkspaceForIssue).not.toHaveBeenCalled()
    expect(codexWorkflowService.startPlanning).not.toHaveBeenCalled()
  })

  it('routes plan review change triggers directly to requestPlanChanges', async () => {
    ;(registryService as unknown as { currentIssueId: number | null }).currentIssueId = 515
    devpodService.getWorkspaceNameForIssue.mockReturnValue('harness-kanban-issue-515')
    readQueueMock.mockResolvedValueOnce([
      {
        msg_id: 21,
        read_ct: 1,
        enqueued_at: new Date('2026-03-15T00:00:00.000Z'),
        vt: null,
        message: {
          issueId: 515,
          workspaceId: 'workspace-1',
          trigger: 'resume_planning',
          previousStatus: 'plan_in_review',
          nextStatus: 'planning',
          requestedAt: '2026-03-15T00:00:00.000Z',
          requestedBy: 'user-1',
        },
      },
    ])

    await (service as unknown as { runDispatchPollingOnce(): Promise<void> }).runDispatchPollingOnce()

    expect(readQueueMock).toHaveBeenCalledWith('harness_issue_dispatch_515', {
      batchSize: 1,
      visibilityTimeoutSeconds: 300,
    })
    expect(codexWorkflowService.requestPlanChanges).toHaveBeenCalledWith({
      issueId: 515,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-515',
    })
    expect(codexWorkflowService.resumePlanning).not.toHaveBeenCalled()
    expect(archiveMessageMock).toHaveBeenCalledWith('harness_issue_dispatch_515', 21)
  })

  it('routes implementation triggers directly to the unified workflow service', async () => {
    ;(registryService as unknown as { currentIssueId: number | null }).currentIssueId = 616
    devpodService.getWorkspaceNameForIssue.mockReturnValue('harness-kanban-issue-616')
    readQueueMock.mockResolvedValueOnce([
      {
        msg_id: 34,
        read_ct: 1,
        enqueued_at: new Date('2026-03-15T00:00:00.000Z'),
        vt: null,
        message: {
          issueId: 616,
          workspaceId: 'workspace-1',
          trigger: 'approve_plan',
          previousStatus: 'plan_in_review',
          nextStatus: 'in_progress',
          requestedAt: '2026-03-15T00:00:00.000Z',
          requestedBy: 'user-1',
        },
      },
    ])

    await (service as unknown as { runDispatchPollingOnce(): Promise<void> }).runDispatchPollingOnce()

    expect(codexWorkflowService.startImplementation).toHaveBeenCalledWith({
      issueId: 616,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-616',
    })
    expect(codexWorkflowService.requestPlanChanges).not.toHaveBeenCalled()
    expect(archiveMessageMock).toHaveBeenCalledWith('harness_issue_dispatch_616', 34)
  })

  it('releases the bound worker when a release trigger is received', async () => {
    ;(registryService as unknown as { currentIssueId: number | null }).currentIssueId = 717
    devpodService.getWorkspaceNameForIssue.mockReturnValue('harness-kanban-issue-717')

    readQueueMock.mockResolvedValueOnce([
      {
        msg_id: 55,
        read_ct: 1,
        enqueued_at: new Date('2026-03-15T00:00:00.000Z'),
        vt: null,
        message: {
          issueId: 717,
          workspaceId: 'workspace-1',
          trigger: 'release_claim',
          previousStatus: 'in_review',
          nextStatus: 'completed',
          requestedAt: '2026-03-15T00:00:00.000Z',
          requestedBy: 'user-1',
        },
      },
    ])

    await (service as unknown as { runDispatchPollingOnce(): Promise<void> }).runDispatchPollingOnce()

    expect(devpodService.getWorkspaceNameForIssue).toHaveBeenCalledWith(717)
    expect(devpodService.deleteWorkspace).toHaveBeenCalledWith('harness-kanban-issue-717')
    expect(codingAgentService.clearIssueCodingAgentSnapshot).toHaveBeenCalledWith(717)
    expect(registryService.releaseClaim).toHaveBeenCalledTimes(1)
    expect(codexWorkflowService.startImplementation).not.toHaveBeenCalled()
    expect(archiveMessageMock).toHaveBeenCalledWith('harness_issue_dispatch_717', 55)
  })

  it('keeps the release trigger pending when workspace deletion fails for a terminal status', async () => {
    ;(registryService as unknown as { currentIssueId: number | null }).currentIssueId = 818
    devpodService.getWorkspaceNameForIssue.mockReturnValue('harness-kanban-issue-818')
    devpodService.deleteWorkspace.mockRejectedValue(new Error('delete failed'))

    readQueueMock.mockResolvedValueOnce([
      {
        msg_id: 56,
        read_ct: 1,
        enqueued_at: new Date('2026-03-15T00:00:00.000Z'),
        vt: null,
        message: {
          issueId: 818,
          workspaceId: 'workspace-1',
          trigger: 'release_claim',
          previousStatus: 'in_review',
          nextStatus: 'canceled',
          requestedAt: '2026-03-15T00:00:00.000Z',
          requestedBy: 'user-1',
        },
      },
    ])

    await (service as unknown as { runDispatchPollingOnce(): Promise<void> }).runDispatchPollingOnce()

    expect(devpodService.deleteWorkspace).toHaveBeenCalledWith('harness-kanban-issue-818')
    expect(registryService.releaseClaim).not.toHaveBeenCalled()
    expect(archiveMessageMock).not.toHaveBeenCalled()
  })
})
