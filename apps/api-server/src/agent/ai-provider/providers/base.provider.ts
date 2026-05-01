import { LanguageModel } from 'ai'

import { AIProvider, ProviderConfig } from '../ai-provider.types'

export abstract class BaseAIProvider implements AIProvider {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly packageName: string
  abstract readonly defaultModel: string

  abstract validateConfig(config: ProviderConfig): void
  abstract createModel(config: ProviderConfig): Promise<LanguageModel>

  protected async importProvider<T>(): Promise<T> {
    try {
      const module = await import(this.packageName)
      return module as T
    } catch {
      throw new Error(
        `Failed to import ${this.name} provider package "${this.packageName}". ` +
          `Please install it with: pnpm add ${this.packageName}`,
      )
    }
  }
}
