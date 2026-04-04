import { AuthService } from '@/auth/auth.service'
import { PrismaService } from '@/database/prisma.service'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { CodingAgentService } from '../coding-agent.service'

describe('CodingAgentService', () => {
  let service: CodingAgentService
  let prismaService: jest.Mocked<PrismaService>
  let authService: jest.Mocked<AuthService>

  const workspaceId = 'workspace-123'
  const userId = 'user-123'

  beforeEach(() => {
    const codingAgentDelegate = {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    }

    prismaService = {
      client: {
        coding_agent: codingAgentDelegate,
        issue_coding_agent_snapshot: {
          findUnique: jest.fn(),
          create: jest.fn(),
          deleteMany: jest.fn(),
        },
        $transaction: jest.fn(async (callback: (tx: { coding_agent: typeof codingAgentDelegate }) => unknown) =>
          callback({
            coding_agent: codingAgentDelegate,
          }),
        ),
      },
    } as unknown as jest.Mocked<PrismaService>

    authService = {
      checkUserPermission: jest.fn(),
      CREATE_ISSUE_PERMISSION: 'create:issue',
      UPDATE_ISSUE_PERMISSION: 'update:issue',
    } as unknown as jest.Mocked<AuthService>

    service = new CodingAgentService(prismaService, authService)
  })

  it('lists coding agents when the caller has update permission', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.coding_agent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Primary Codex',
        type: 'codex',
        settings: {
          authMode: 'api-key',
          apiKey: 'sk-test-123',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'medium',
        },
        is_default: true,
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
      },
    ])

    const result = await service.getCodingAgents(userId, workspaceId)

    expect(prismaService.client.coding_agent.findMany).toHaveBeenCalledWith({
      orderBy: [{ type: 'asc' }, { is_default: 'desc' }, { created_at: 'asc' }],
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('Primary Codex')
  })

  it('returns a coding agent by id when the caller has update permission', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.coding_agent.findUnique as jest.Mock).mockResolvedValue({
      id: 'agent-1',
      name: 'Primary Codex',
      type: 'codex',
      settings: {
        authMode: 'api-key',
        apiKey: 'sk-test-123',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'medium',
      },
      is_default: true,
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
    })

    const result = await service.getCodingAgentById(userId, workspaceId, 'agent-1')

    expect(result.id).toBe('agent-1')
    expect(result.type).toBe('codex')
  })

  it('creates a Codex coding agent and normalizes settings', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.coding_agent.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prismaService.client.coding_agent.create as jest.Mock).mockResolvedValue({
      id: 'agent-1',
      name: 'Primary Codex',
      type: 'codex',
      settings: {
        authMode: 'api-key',
        apiKey: 'sk-test-123',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'medium',
      },
      is_default: true,
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
    })

    const result = await service.createCodingAgent(userId, workspaceId, {
      name: '  Primary Codex  ',
      type: 'codex',
      settings: {
        authMode: 'api-key',
        apiKey: '  sk-test-123  ',
        model: '  gpt-5.3-codex  ',
        reasoningEffort: 'medium',
      },
      isDefault: true,
    })

    expect(prismaService.client.coding_agent.updateMany).toHaveBeenCalledWith({
      where: {
        type: 'codex',
        is_default: true,
      },
      data: {
        is_default: false,
      },
    })
    expect(prismaService.client.coding_agent.create).toHaveBeenCalledWith({
      data: {
        name: 'Primary Codex',
        type: 'codex',
        settings: {
          authMode: 'api-key',
          apiKey: 'sk-test-123',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'medium',
        },
        is_default: true,
      },
    })
    expect(result.type).toBe('codex')
  })

  it('rejects duplicate coding agent names', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.coding_agent.findUnique as jest.Mock).mockResolvedValue({ id: 'existing-agent' })

    await expect(
      service.createCodingAgent(userId, workspaceId, {
        name: 'Primary Codex',
        type: 'codex',
        settings: {
          authMode: 'api-key',
          apiKey: 'sk-test-123',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'medium',
        },
      }),
    ).rejects.toThrow(new BadRequestException('A coding agent with this name already exists.'))
  })

  it('rejects settings that do not match the selected type', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.coding_agent.findUnique as jest.Mock).mockResolvedValue(null)

    await expect(
      service.createCodingAgent(userId, workspaceId, {
        name: 'Broken Agent',
        type: 'claude-code',
        settings: {
          authMode: 'api-key',
          apiKey: 'sk-test-123',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'medium',
        } as any,
      }),
    ).rejects.toThrow(new BadRequestException('Coding agent settings are invalid for type "claude-code".'))
  })

  it('revalidates settings when the type changes during update', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.coding_agent.findUnique as jest.Mock).mockResolvedValue({
      id: 'agent-1',
      name: 'Primary Codex',
      type: 'codex',
      settings: {
        authMode: 'api-key',
        apiKey: 'sk-test-123',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'medium',
      },
      is_default: false,
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
    })

    await expect(
      service.updateCodingAgent(userId, workspaceId, 'agent-1', {
        type: 'claude-code',
      }),
    ).rejects.toThrow(new BadRequestException('Coding agent settings are invalid for type "claude-code".'))
  })

  it('deletes an existing coding agent', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.coding_agent.findUnique as jest.Mock).mockResolvedValue({ id: 'agent-1' })

    await service.deleteCodingAgent(userId, workspaceId, 'agent-1')

    expect(prismaService.client.coding_agent.delete).toHaveBeenCalledWith({
      where: {
        id: 'agent-1',
      },
    })
  })

  it('reports whether a coding agent exists for a given type', async () => {
    ;(prismaService.client.coding_agent.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'agent-1' })

    await expect(service.hasCodingAgentConfigured('codex')).resolves.toBe(true)
    expect(prismaService.client.coding_agent.findFirst).toHaveBeenCalledWith({
      where: {
        type: 'codex',
      },
      select: {
        id: true,
      },
      orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
    })
    ;(prismaService.client.coding_agent.findFirst as jest.Mock).mockResolvedValueOnce(null)

    await expect(service.hasCodingAgentConfigured('codex')).resolves.toBe(false)
  })

  it('throws when deleting a missing coding agent', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.coding_agent.findUnique as jest.Mock).mockResolvedValue(null)

    await expect(service.deleteCodingAgent(userId, workspaceId, 'missing')).rejects.toThrow(
      new NotFoundException('Coding agent does not exist.'),
    )
  })

  it('rejects create when the caller lacks permission', async () => {
    authService.checkUserPermission.mockResolvedValue(false)

    await expect(
      service.createCodingAgent(userId, workspaceId, {
        name: 'Primary Codex',
        type: 'codex',
        settings: {
          authMode: 'api-key',
          apiKey: 'sk-test-123',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'medium',
        },
      }),
    ).rejects.toThrow(new ForbiddenException('No access to create coding agents'))
  })

  it('rejects list when the caller lacks permission', async () => {
    authService.checkUserPermission.mockResolvedValue(false)

    await expect(service.getCodingAgents(userId, workspaceId)).rejects.toThrow(
      new ForbiddenException('No access to view coding agents'),
    )
  })

  // TODO: how to recover from an unfinished issue is still uncertain. will come back to this in the future.
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
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
      })
    ;(prismaService.client.coding_agent.findFirst as jest.Mock)
      .mockResolvedValueOnce({
        id: 'agent-1',
        name: 'Primary Codex',
        type: 'codex',
        settings: {
          authMode: 'api-key',
          apiKey: 'sk-test-123',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'medium',
        },
        is_default: true,
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'agent-1',
        name: 'Primary Codex',
        type: 'codex',
        settings: {
          authMode: 'api-key',
          apiKey: 'sk-test-123',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'medium',
        },
        is_default: true,
        created_at: new Date('2026-04-03T00:00:00.000Z'),
        updated_at: new Date('2026-04-03T00:00:00.000Z'),
      })
    ;(prismaService.client.issue_coding_agent_snapshot.create as jest.Mock).mockRejectedValue({ code: 'P2002' })

    const result = await service.ensureIssueCodingAgentSnapshot(123, 'codex')

    expect(prismaService.client.coding_agent.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        type: 'codex',
        is_default: true,
      },
      orderBy: [{ created_at: 'asc' }],
    })
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
      },
    })
    expect(result?.id).toBe('snapshot-1')
  })

  it('falls back to the first coding agent when no default is configured', async () => {
    ;(prismaService.client.issue_coding_agent_snapshot.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prismaService.client.coding_agent.findFirst as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'agent-2',
      name: 'Fallback Codex',
      type: 'codex',
      settings: {
        authMode: 'api-key',
        apiKey: 'sk-fallback-123',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'low',
      },
      is_default: false,
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
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
      created_at: new Date('2026-04-03T00:00:00.000Z'),
      updated_at: new Date('2026-04-03T00:00:00.000Z'),
    })

    const result = await service.ensureIssueCodingAgentSnapshot(456, 'codex')

    expect(prismaService.client.coding_agent.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        type: 'codex',
        is_default: true,
      },
      orderBy: [{ created_at: 'asc' }],
    })
    expect(prismaService.client.coding_agent.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        type: 'codex',
      },
      orderBy: [{ created_at: 'asc' }],
    })
    expect(result.id).toBe('snapshot-2')
  })

  it('throws when no coding agent is configured for the requested type', async () => {
    ;(prismaService.client.issue_coding_agent_snapshot.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prismaService.client.coding_agent.findFirst as jest.Mock).mockResolvedValue(null)

    await expect(service.ensureIssueCodingAgentSnapshot(789, 'codex')).rejects.toThrow(
      new NotFoundException('No coding agent is configured for type "codex".'),
    )
  })
})
