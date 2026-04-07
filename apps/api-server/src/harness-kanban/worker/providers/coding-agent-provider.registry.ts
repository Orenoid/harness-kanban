import { Injectable } from '@nestjs/common'
import { CodingAgentType } from '@repo/shared'
import { HarnessWorkerCodingAgentProvider } from './coding-agent-provider.types'
import { HarnessWorkerClaudeCodeProvider } from './harness-worker-claude-code.provider'
import { HarnessWorkerCodexProvider } from './harness-worker-codex.provider'

@Injectable()
export class HarnessWorkerCodingAgentProviderRegistry {
  private readonly providers: Map<CodingAgentType, HarnessWorkerCodingAgentProvider>

  constructor(
    private readonly codexProvider: HarnessWorkerCodexProvider,
    private readonly claudeCodeProvider: HarnessWorkerClaudeCodeProvider,
  ) {
    this.providers = new Map<CodingAgentType, HarnessWorkerCodingAgentProvider>([
      ['codex', this.codexProvider],
      ['claude-code', this.claudeCodeProvider],
    ])
  }

  getProvider(type: CodingAgentType): HarnessWorkerCodingAgentProvider {
    const provider = this.providers.get(type)
    if (!provider) {
      throw new Error(`Coding agent provider "${type}" is not registered.`)
    }

    return provider
  }
}
