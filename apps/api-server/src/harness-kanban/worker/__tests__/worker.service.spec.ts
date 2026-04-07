import { PrismaService } from '@/database/prisma.service'
import { CodingAgentSnapshotService } from '@/harness-kanban/coding-agent/coding-agent-snapshot.service'
import { IssueService } from '@/issue/issue.service'
import { PgmqService } from '@/pgmq/pgmq.service'
import { SystemBotId } from '@/user/constants/user.constants'
import { CommonPropertyOperationType, SystemPropertyId } from '@repo/shared/property/constants'
import { HarnessWorkerCodingAgentWorkflowService } from '../coding-agent-workflow.service'
import { HarnessWorkerDevpodService } from '../devpod.service'
import { WorkerService } from '../worker.service'

describe('WorkerService', () => {
  let service: WorkerService
  let prismaService: jest.Mocked<PrismaService>
  let codingAgentSnapshotService: jest.Mocked<CodingAgentSnapshotService>
  let issueService: jest.Mocked<IssueService>
  let pgmqService: jest.Mocked<PgmqService>
  let devpodService: jest.Mocked<HarnessWorkerDevpodService>
  let codingAgentWorkflowService: jest.Mocked<HarnessWorkerCodingAgentWorkflowService>
  let readQueueMock: jest.Mock
  let archiveMessageMock: jest.Mock

  beforeEach(() => {
    prismaService = {
      client: {
        harness_worker: {
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
      },
    } as unknown as jest.Mocked<PrismaService>

    codingAgentSnapshotService = {
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
        isDefault: false,
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      }),
      clearIssueCodingAgentSnapshot: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CodingAgentSnapshotService>

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

    codingAgentWorkflowService = {
      startPlanning: jest.fn(),
      resumePlanning: jest.fn(),
      requestPlanChanges: jest.fn(),
      startImplementation: jest.fn(),
      resumeImplementation: jest.fn(),
      applyRequestedCodeChanges: jest.fn(),
    } as unknown as jest.Mocked<HarnessWorkerCodingAgentWorkflowService>

    service = new WorkerService(
      prismaService,
      devpodService,
      codingAgentSnapshotService,
      codingAgentWorkflowService,
      issueService,
      pgmqService,
    )
  })

  it('moves a claimed Code Bot issue to planning, creates the workspace, and starts planning workflow', async () => {
    jest.spyOn(service, 'claimNextQueuedIssue').mockResolvedValue({
      issueId: 101,
      workspaceId: 'workspace-1',
    })
    jest.spyOn(service, 'releaseClaim').mockResolvedValue(undefined)
    issueService.updateIssue.mockResolvedValue({
      success: true,
      issueId: 101,
    })
    devpodService.createWorkspaceForIssue.mockResolvedValue('harness-kanban-issue-101')

    await (service as unknown as { runClaimPollingOnce(): Promise<void> }).runClaimPollingOnce()

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
    expect(codingAgentSnapshotService.ensureIssueCodingAgentSnapshot).toHaveBeenCalledWith(101, 'workspace-1')
    expect(codingAgentWorkflowService.startPlanning).toHaveBeenCalledWith({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })
    expect(service.releaseClaim).not.toHaveBeenCalled()
  })

  it('releases the claim when the planning transition fails', async () => {
    jest.spyOn(service, 'claimNextQueuedIssue').mockResolvedValue({
      issueId: 303,
      workspaceId: 'workspace-1',
    })
    jest.spyOn(service, 'releaseClaim').mockResolvedValue(undefined)
    issueService.updateIssue.mockResolvedValue({
      success: false,
      errors: ['transition failed'],
    })

    await (service as unknown as { runClaimPollingOnce(): Promise<void> }).runClaimPollingOnce()

    expect(service.releaseClaim).toHaveBeenCalledTimes(1)
    expect(devpodService.createWorkspaceForIssue).not.toHaveBeenCalled()
    expect(codingAgentWorkflowService.startPlanning).not.toHaveBeenCalled()
  })

  it('does not start planning when the coding agent snapshot cannot be created', async () => {
    jest.spyOn(service, 'claimNextQueuedIssue').mockResolvedValue({
      issueId: 404,
      workspaceId: 'workspace-1',
    })
    issueService.updateIssue.mockResolvedValue({
      success: true,
      issueId: 404,
    })
    codingAgentSnapshotService.ensureIssueCodingAgentSnapshot.mockRejectedValue(
      new Error('No coding agent is configured for workspace "workspace-1".'),
    )

    await (service as unknown as { runClaimPollingOnce(): Promise<void> }).runClaimPollingOnce()

    expect(devpodService.createWorkspaceForIssue).not.toHaveBeenCalled()
    expect(codingAgentWorkflowService.startPlanning).not.toHaveBeenCalled()
  })

  it('routes plan review change triggers directly to requestPlanChanges', async () => {
    ;(service as unknown as { claimedIssueId: number | null }).claimedIssueId = 515
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
    expect(codingAgentWorkflowService.requestPlanChanges).toHaveBeenCalledWith({
      issueId: 515,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-515',
    })
    expect(codingAgentWorkflowService.resumePlanning).not.toHaveBeenCalled()
    expect(archiveMessageMock).toHaveBeenCalledWith('harness_issue_dispatch_515', 21)
  })

  it('routes implementation triggers directly to the unified workflow service', async () => {
    ;(service as unknown as { claimedIssueId: number | null }).claimedIssueId = 616
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

    expect(codingAgentWorkflowService.startImplementation).toHaveBeenCalledWith({
      issueId: 616,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-616',
    })
    expect(codingAgentWorkflowService.requestPlanChanges).not.toHaveBeenCalled()
    expect(archiveMessageMock).toHaveBeenCalledWith('harness_issue_dispatch_616', 34)
  })

  it('releases the bound worker when a release trigger is received', async () => {
    ;(service as unknown as { claimedIssueId: number | null }).claimedIssueId = 717
    jest.spyOn(service, 'releaseClaim').mockResolvedValue(undefined)
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
    expect(codingAgentSnapshotService.clearIssueCodingAgentSnapshot).toHaveBeenCalledWith(717)
    expect(service.releaseClaim).toHaveBeenCalledTimes(1)
    expect(codingAgentWorkflowService.startImplementation).not.toHaveBeenCalled()
    expect(archiveMessageMock).toHaveBeenCalledWith('harness_issue_dispatch_717', 55)
  })
})
