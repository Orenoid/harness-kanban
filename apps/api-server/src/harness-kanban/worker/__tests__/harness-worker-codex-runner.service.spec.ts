import { CodingAgentService } from '@/coding-agent/coding-agent.service'
import { PrismaService } from '@/database/prisma.service'
import { ConfigService } from '@nestjs/config'
import { HarnessWorkerCodexRunnerService } from '../harness-worker-codex-runner.service'
import { HarnessWorkerDevpodService } from '../harness-worker-devpod.service'

describe('HarnessWorkerCodexRunnerService', () => {
  let service: HarnessWorkerCodexRunnerService
  let prismaService: jest.Mocked<PrismaService>
  let configService: jest.Mocked<ConfigService>
  let codingAgentService: jest.Mocked<CodingAgentService>
  let devpodService: jest.Mocked<HarnessWorkerDevpodService>

  beforeEach(() => {
    prismaService = {
      client: {
        harness_worker: {
          findFirst: jest.fn().mockResolvedValue({
            devpod_metadata: {
              result: {
                substitution: {
                  containerWorkspaceFolder: '/workspaces/harness-kanban-issue-101',
                },
              },
            },
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    } as unknown as jest.Mocked<PrismaService>

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'HARNESS_WORKER_CODEX_TIMEOUT_MS') {
          return '1800000'
        }

        return undefined
      }),
    } as unknown as jest.Mocked<ConfigService>

    codingAgentService = {
      getIssueCodingAgentSnapshot: jest.fn(),
    } as unknown as jest.Mocked<CodingAgentService>

    devpodService = {
      runWorkspaceCommand: jest.fn(),
    } as unknown as jest.Mocked<HarnessWorkerDevpodService>

    service = new HarnessWorkerCodexRunnerService(prismaService, configService, codingAgentService, devpodService)
  })

  it('forwards CODEX_API_KEY and persisted execution settings to codex exec', async () => {
    codingAgentService.getIssueCodingAgentSnapshot.mockResolvedValue({
      id: 'agent-1',
      name: 'Primary Codex',
      type: 'codex',
      settings: {
        authMode: 'api-key',
        apiKey: 'sk-test-123',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'low',
      },
      isDefault: true,
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
    })
    devpodService.runWorkspaceCommand.mockResolvedValue({
      stdout: JSON.stringify({
        threadId: 'thread-1',
        finalMessage: 'hello',
        exitCode: 0,
        errorMessages: [],
        codexStderr: '',
      }),
      stderr: '',
    })

    const result = await service.runCodexWithSchema({
      issueId: 101,
      outputJsonSchema: { type: 'object' },
      prompt: 'hi',
      repoRoot: '/workspaces/harness-kanban-issue-101',
      workspaceName: 'harness-kanban-issue-101',
      workflowLabel: 'planning',
    })

    expect(result).toEqual({
      finalMessage: 'hello',
      threadId: 'thread-1',
    })
    expect(devpodService.runWorkspaceCommand).toHaveBeenCalledWith(
      'harness-kanban-issue-101',
      expect.stringContaining("codex exec '-m' 'gpt-5.3-codex' '--config' 'model_reasoning_effort=\"low\"'"),
      expect.objectContaining({
        forwardEnv: {
          CODEX_API_KEY: 'sk-test-123',
        },
      }),
    )
  })

  it('redacts API keys from execution failures', async () => {
    codingAgentService.getIssueCodingAgentSnapshot.mockResolvedValue({
      id: 'agent-1',
      name: 'Primary Codex',
      type: 'codex',
      settings: {
        authMode: 'api-key',
        apiKey: 'sk-test-secret',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'medium',
      },
      isDefault: true,
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T00:00:00.000Z',
    })
    devpodService.runWorkspaceCommand.mockRejectedValue(new Error('request failed for sk-test-secret'))

    await expect(
      service.runCodexWithSchema({
        issueId: 101,
        outputJsonSchema: { type: 'object' },
        prompt: 'hi',
        repoRoot: '/workspaces/harness-kanban-issue-101',
        workspaceName: 'harness-kanban-issue-101',
        workflowLabel: 'planning',
      }),
    ).rejects.toThrow('***')
  })
})
