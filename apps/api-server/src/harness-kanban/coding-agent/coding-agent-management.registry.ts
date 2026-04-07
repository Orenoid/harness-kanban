import { BadRequestException, Injectable } from '@nestjs/common'
import {
  ClaudeCodeCodingAgentSettings,
  CodexCodingAgentSettings,
  CodingAgentDetail,
  CodingAgentManagementDetail,
  CodingAgentType,
  CreateClaudeCodeCodingAgentManagementSettings,
  createClaudeCodeCodingAgentManagementSettingsSchema,
  CreateCodexCodingAgentManagementSettings,
  createCodexCodingAgentManagementSettingsSchema,
  CreateCodingAgentInput,
  UpdateClaudeCodeCodingAgentManagementSettings,
  updateClaudeCodeCodingAgentManagementSettingsSchema,
  UpdateCodexCodingAgentManagementSettings,
  updateCodexCodingAgentManagementSettingsSchema,
  UpdateCodingAgentInput,
} from '@repo/shared'
import type { ZodType } from 'zod'

type CreateManagementPayload = {
  name: string
  type: CodingAgentType
  settings: unknown
  isDefault?: boolean
}

type UpdateManagementPayload = {
  name?: string
  settings?: unknown
  isDefault?: boolean
}

@Injectable()
export class CodingAgentManagementRegistry {
  toManagementDetail(codingAgent: CodingAgentDetail): CodingAgentManagementDetail {
    if (codingAgent.type === 'codex') {
      const settings = codingAgent.settings as CodexCodingAgentSettings

      return {
        ...codingAgent,
        settings: {
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
          hasCredential: settings.authMode === 'auth-json' || settings.apiKey.trim().length > 0,
        },
      }
    }

    if (codingAgent.type === 'claude-code') {
      const settings = codingAgent.settings as ClaudeCodeCodingAgentSettings

      return {
        ...codingAgent,
        settings: {
          model: settings.model,
          baseUrl: settings.baseUrl,
          hasCredential: settings.apiKey.trim().length > 0,
        },
      }
    }

    throw new BadRequestException(`Coding agent type "${codingAgent.type}" is not configurable.`)
  }

  toCreateInput(payload: CreateManagementPayload): CreateCodingAgentInput {
    if (payload.type === 'codex') {
      const settings = this.parseWithSchema(
        createCodexCodingAgentManagementSettingsSchema,
        payload.settings,
        payload.type,
      ) as CreateCodexCodingAgentManagementSettings

      return {
        name: payload.name,
        type: 'codex',
        settings: {
          authMode: 'api-key',
          apiKey: settings.apiKey,
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
        },
        isDefault: payload.isDefault,
      }
    }

    if (payload.type === 'claude-code') {
      const settings = this.parseWithSchema(
        createClaudeCodeCodingAgentManagementSettingsSchema,
        payload.settings,
        payload.type,
      ) as CreateClaudeCodeCodingAgentManagementSettings

      return {
        name: payload.name,
        type: 'claude-code',
        settings: {
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          model: settings.model,
        },
        isDefault: payload.isDefault,
      }
    }

    throw new BadRequestException(`Coding agent type "${payload.type}" is not configurable.`)
  }

  toUpdateInput(existingCodingAgent: CodingAgentDetail, payload: UpdateManagementPayload): UpdateCodingAgentInput {
    const nextInput: UpdateCodingAgentInput = {}

    if ('name' in payload && payload.name !== undefined) {
      nextInput.name = payload.name
    }

    if ('isDefault' in payload && payload.isDefault !== undefined) {
      nextInput.isDefault = payload.isDefault
    }

    if ('settings' in payload && payload.settings !== undefined) {
      if (existingCodingAgent.type === 'codex') {
        const inputSettings = this.parseWithSchema(
          updateCodexCodingAgentManagementSettingsSchema,
          payload.settings,
          existingCodingAgent.type,
        ) as UpdateCodexCodingAgentManagementSettings
        const existingSettings = existingCodingAgent.settings as CodexCodingAgentSettings
        const trimmedApiKey = inputSettings.apiKey?.trim()

        nextInput.settings = trimmedApiKey
          ? {
              authMode: 'api-key',
              apiKey: trimmedApiKey,
              model: inputSettings.model,
              reasoningEffort: inputSettings.reasoningEffort,
            }
          : existingSettings.authMode === 'auth-json'
            ? {
                authMode: 'auth-json',
                authJson: existingSettings.authJson,
                model: inputSettings.model,
                reasoningEffort: inputSettings.reasoningEffort,
              }
            : {
                authMode: 'api-key',
                apiKey: existingSettings.apiKey,
                model: inputSettings.model,
                reasoningEffort: inputSettings.reasoningEffort,
              }

        return nextInput
      }

      if (existingCodingAgent.type === 'claude-code') {
        const inputSettings = this.parseWithSchema(
          updateClaudeCodeCodingAgentManagementSettingsSchema,
          payload.settings,
          existingCodingAgent.type,
        ) as UpdateClaudeCodeCodingAgentManagementSettings
        const existingSettings = existingCodingAgent.settings as ClaudeCodeCodingAgentSettings
        const trimmedApiKey = inputSettings.apiKey?.trim()

        nextInput.settings = {
          apiKey: trimmedApiKey || existingSettings.apiKey,
          baseUrl: inputSettings.baseUrl,
          model: inputSettings.model,
        }

        return nextInput
      }

      throw new BadRequestException(`Coding agent type "${existingCodingAgent.type}" is not configurable.`)
    }

    return nextInput
  }

  private parseWithSchema<TParsed>(schema: ZodType<TParsed>, value: unknown, type: CodingAgentType): TParsed {
    const parsed = schema.safeParse(value)
    if (parsed.success) {
      return parsed.data
    }

    throw new BadRequestException(
      `Coding agent settings are invalid for type "${type}": ${parsed.error.issues.map(issue => issue.message).join('; ')}`,
    )
  }
}
