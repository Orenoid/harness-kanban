import { LanguageModel } from 'ai'

import { ProviderConfig } from '../ai-provider.types'
import { BaseAIProvider } from './base.provider'

export class VercelAIGatewayProvider extends BaseAIProvider {
  readonly id = 'vercel-ai-gateway' as const
  readonly name = 'Vercel AI Gateway'
  readonly packageName = 'ai'
  readonly defaultModel = 'openai/gpt-4o-mini'

  validateConfig(): void {
    // Vercel AI Gateway can work without explicit URL (uses default)
  }

  async createModel(_config: ProviderConfig): Promise<LanguageModel> {
    // Import from 'ai' package directly
    const { gateway } = await import('ai')
    return gateway(_config.model)
  }
}
