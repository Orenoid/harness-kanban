import { CodingAgentService } from '@/coding-agent/coding-agent.service'
import { CodexCodingAgentSettings } from '@repo/shared'

export type ResolvedCodexAuthConfig =
  | {
      authMode: 'auth-json'
      authJson: string
      model: string
      reasoningEffort: CodexCodingAgentSettings['reasoningEffort']
    }
  | {
      authMode: 'api-key'
      apiKey: string
      model: string
      reasoningEffort: CodexCodingAgentSettings['reasoningEffort']
    }

export async function resolveCodexAuthConfig(
  codingAgentService: CodingAgentService,
  issueId: number,
): Promise<ResolvedCodexAuthConfig | null> {
  const codingAgent = await codingAgentService.getIssueCodingAgentSnapshot(issueId, 'codex')
  if (!codingAgent) {
    return null
  }

  const settings = codingAgent.settings as CodexCodingAgentSettings
  if (settings.authMode === 'auth-json') {
    return {
      authMode: 'auth-json',
      authJson: JSON.stringify(settings.authJson),
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
    }
  }

  return {
    authMode: 'api-key',
    apiKey: settings.apiKey,
    model: settings.model,
    reasoningEffort: settings.reasoningEffort,
  }
}

export const getCodexAuthSensitiveValues = (config: ResolvedCodexAuthConfig | null): string[] => {
  if (!config) {
    return []
  }

  const values = config.authMode === 'auth-json' ? [config.authJson] : [config.apiKey]

  return values.filter((value, index, collection) => value.length > 0 && collection.indexOf(value) === index)
}

export const buildCodexExecArgs = (config: ResolvedCodexAuthConfig): string[] => [
  '-m',
  config.model,
  '--config',
  `model_reasoning_effort=${JSON.stringify(config.reasoningEffort)}`,
]
