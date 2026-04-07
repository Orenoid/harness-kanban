import { PrismaService } from '@/database/prisma.service'
import { NotFoundException } from '@nestjs/common'
import { CodingAgentSnapshotService } from '../coding-agent-snapshot.service'
import { CodingAgentService } from '../coding-agent.service'

describe('CodingAgentSnapshotService', () => {
  let service: CodingAgentSnapshotService
  let prismaService: jest.Mocked<PrismaService>
  let codingAgentService: jest.Mocked<CodingAgentService>

  const workspaceId = 'workspace-123'

  beforeEach(() => {
    prismaService = {
      client: {
        issue_coding_agent_snapshot: {
          findUnique: jest.fn(),
          create: jest.fn(),
          updateMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      },
    } as unknown as jest.Mocked<PrismaService>

    codingAgentService = {
      getDefaultCodingAgent: jest.fn(),
      getFirstCodingAgent: jest.fn(),
    } as unknown as jest.Mocked<CodingAgentService>

    service = new CodingAgentSnapshotService(prismaService, codingAgentService)
  })

  it('creates and reuses an issue coding agent snapshot', async () => {
    ;(prismaService.client.issue_coding_agent_snapshot.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'snapshot-1',
        issue_id: 123,
        source_coding_agent_id: 'agent-1',
        name: 'Primary Codex',
        type: 'codex',
        settings: {
          authMode: 'api-key',
          apiKey: 'sk-test-123',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'medium',
        },
        execution_state: null,
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
      })
    codingAgentService.getDefaultCodingAgent.mockResolvedValue({
      id: 'agent-1',
      name: 'Primary Codex',
      type: 'codex',
      settings: {
        authMode: 'api-key',
        apiKey: 'sk-test-123',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'medium',
      },
      isDefault: true,
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
    })
    ;(prismaService.client.issue_coding_agent_snapshot.create as jest.Mock).mockRejectedValue({ code: 'P2002' })

    const result = await service.ensureIssueCodingAgentSnapshot(123, workspaceId)

    expect(codingAgentService.getDefaultCodingAgent).toHaveBeenCalledWith(workspaceId)
    expect(prismaService.client.issue_coding_agent_snapshot.create).toHaveBeenCalledWith({
      data: {
        issue_id: 123,
        source_coding_agent_id: 'agent-1',
        name: 'Primary Codex',
        type: 'codex',
        settings: {
          authMode: 'api-key',
          apiKey: 'sk-test-123',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'medium',
        },
        execution_state: expect.anything(),
      },
    })
    expect(result.id).toBe('snapshot-1')
  })

  it('falls back to the first coding agent when no default is configured', async () => {
    ;(prismaService.client.issue_coding_agent_snapshot.findUnique as jest.Mock).mockResolvedValue(null)
    codingAgentService.getDefaultCodingAgent.mockResolvedValue(null)
    codingAgentService.getFirstCodingAgent.mockResolvedValue({
      id: 'agent-2',
      name: 'Fallback Codex',
      type: 'codex',
      settings: {
        authMode: 'api-key',
        apiKey: 'sk-fallback-123',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'low',
      },
      isDefault: false,
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
    })
    ;(prismaService.client.issue_coding_agent_snapshot.create as jest.Mock).mockResolvedValue({
      id: 'snapshot-2',
      issue_id: 456,
      source_coding_agent_id: 'agent-2',
      name: 'Fallback Codex',
      type: 'codex',
      settings: {
        authMode: 'api-key',
        apiKey: 'sk-fallback-123',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'low',
      },
      execution_state: null,
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
    })

    const result = await service.ensureIssueCodingAgentSnapshot(456, workspaceId)

    expect(codingAgentService.getDefaultCodingAgent).toHaveBeenCalledWith(workspaceId)
    expect(codingAgentService.getFirstCodingAgent).toHaveBeenCalledWith(workspaceId)
    expect(result.id).toBe('snapshot-2')
  })

  it('throws when no coding agent is configured for the workspace', async () => {
    ;(prismaService.client.issue_coding_agent_snapshot.findUnique as jest.Mock).mockResolvedValue(null)
    codingAgentService.getDefaultCodingAgent.mockResolvedValue(null)
    codingAgentService.getFirstCodingAgent.mockResolvedValue(null)

    await expect(service.ensureIssueCodingAgentSnapshot(789, workspaceId)).rejects.toThrow(
      new NotFoundException(`No coding agent is configured for workspace "${workspaceId}".`),
    )
  })
})
