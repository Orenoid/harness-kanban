import { CodingAgentService } from '@/coding-agent/coding-agent.service'
import { buildCodexExecArgs, getCodexAuthSensitiveValues, resolveCodexAuthConfig } from '../harness-worker-codex-auth'

describe('resolveCodexAuthConfig', () => {
  it('returns serialized auth.json config for a persisted Codex agent', async () => {
    const codingAgentService = {
      getIssueCodingAgentSnapshot: jest.fn().mockResolvedValue({
        id: 'agent-1',
        name: 'Primary Codex',
        type: 'codex',
        settings: {
          authMode: 'auth-json',
          authJson: {
            provider: 'openai',
            accessToken: 'inline-token',
          },
          model: 'gpt-5.3-codex',
          reasoningEffort: 'low',
        },
        isDefault: true,
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
      }),
    } as unknown as jest.Mocked<CodingAgentService>

    await expect(resolveCodexAuthConfig(codingAgentService, 101)).resolves.toEqual({
      authMode: 'auth-json',
      authJson: '{"provider":"openai","accessToken":"inline-token"}',
      model: 'gpt-5.3-codex',
      reasoningEffort: 'low',
    })
  })

  it('returns API key config for a persisted Codex agent', async () => {
    const codingAgentService = {
      getIssueCodingAgentSnapshot: jest.fn().mockResolvedValue({
        id: 'agent-1',
        name: 'Primary Codex',
        type: 'codex',
        settings: {
          authMode: 'api-key',
          apiKey: 'sk-test-123',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'high',
        },
        isDefault: false,
        createdAt: '2026-04-03T00:00:00.000Z',
        updatedAt: '2026-04-03T00:00:00.000Z',
      }),
    } as unknown as jest.Mocked<CodingAgentService>

    await expect(resolveCodexAuthConfig(codingAgentService, 101)).resolves.toEqual({
      authMode: 'api-key',
      apiKey: 'sk-test-123',
      model: 'gpt-5.3-codex',
      reasoningEffort: 'high',
    })
  })

  it('returns null when no Codex agent is configured', async () => {
    const codingAgentService = {
      getIssueCodingAgentSnapshot: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<CodingAgentService>

    await expect(resolveCodexAuthConfig(codingAgentService, 101)).resolves.toBeNull()
  })
})

describe('Codex auth helpers', () => {
  it('returns secret values for redaction', () => {
    expect(
      getCodexAuthSensitiveValues({
        authMode: 'api-key',
        apiKey: 'sk-test-123',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'medium',
      }),
    ).toEqual(['sk-test-123'])
  })

  it('builds Codex exec args with model and reasoning effort', () => {
    expect(
      buildCodexExecArgs({
        authMode: 'api-key',
        apiKey: 'sk-test-123',
        model: 'gpt-5.3-codex',
        reasoningEffort: 'low',
      }),
    ).toEqual(['-m', 'gpt-5.3-codex', '--config', 'model_reasoning_effort="low"'])
  })
})
