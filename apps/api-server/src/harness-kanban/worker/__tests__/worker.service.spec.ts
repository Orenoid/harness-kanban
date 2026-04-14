import { PrismaService } from '@/database/prisma.service'
import { CodingAgentSnapshotService } from '@/harness-kanban/coding-agent/coding-agent-snapshot.service'
import { PgmqService } from '@/pgmq/pgmq.service'
import { HarnessWorkerCodingAgentWorkflowService } from '../coding-agent-workflow.service'
import { HarnessWorkerDevpodService } from '../devpod.service'
import { WorkerService } from '../worker.service'

describe('WorkerService', () => {
  let service: WorkerService
  let prismaService: jest.Mocked<PrismaService>
  let codingAgentSnapshotService: jest.Mocked<CodingAgentSnapshotService>
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
          findFirst: jest.fn(),
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
      startClaimedIssuePlanning: jest.fn(),
      handleContinuationTrigger: jest.fn(),
    } as unknown as jest.Mocked<HarnessWorkerCodingAgentWorkflowService>

    service = new WorkerService(
      prismaService,
      devpodService,
      codingAgentSnapshotService,
      codingAgentWorkflowService,
      pgmqService,
    )
  })

  it('delegates a claimed Code Bot issue to the workflow service', async () => {
    jest.spyOn(service, 'claimNextQueuedIssue').mockResolvedValue({
      issueId: 101,
      workspaceId: 'workspace-1',
    })
    jest.spyOn(service, 'releaseClaim').mockResolvedValue(undefined)

    await (service as unknown as { runClaimPollingOnce(): Promise<void> }).runClaimPollingOnce()

    expect(codingAgentWorkflowService.startClaimedIssuePlanning).toHaveBeenCalledWith({
      issueId: 101,
      workspaceId: 'workspace-1',
    })
    expect(service.releaseClaim).not.toHaveBeenCalled()
  })

  it('delegates non-release continuation triggers to the workflow service', async () => {
    ;(service as unknown as { claimedIssueId: number | null }).claimedIssueId = 515
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
    expect(codingAgentWorkflowService.handleContinuationTrigger).toHaveBeenCalledWith({
      issueId: 515,
      workspaceId: 'workspace-1',
      trigger: 'resume_planning',
      previousStatus: 'plan_in_review',
      nextStatus: 'planning',
      requestedAt: '2026-03-15T00:00:00.000Z',
      requestedBy: 'user-1',
    })
    expect(archiveMessageMock).toHaveBeenCalledWith('harness_issue_dispatch_515', 21)
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
    expect(codingAgentWorkflowService.handleContinuationTrigger).not.toHaveBeenCalled()
    expect(archiveMessageMock).toHaveBeenCalledWith('harness_issue_dispatch_717', 55)
  })
})
