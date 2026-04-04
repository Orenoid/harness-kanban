import { z } from 'zod'

const codingAgentNameMaxLength = 120

export const codingAgentTypeSchema = z.enum(['codex', 'claude-code'])
export type CodingAgentType = z.infer<typeof codingAgentTypeSchema>

export const configurableCodingAgentTypeSchema = z.enum(['codex'])
export type ConfigurableCodingAgentType = z.infer<typeof configurableCodingAgentTypeSchema>

export const codingAgentManagementAvailabilitySchema = z.enum(['available', 'coming-soon'])
export type CodingAgentManagementAvailability = z.infer<typeof codingAgentManagementAvailabilitySchema>

export const codexReasoningEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh'])
export type CodexReasoningEffort = z.infer<typeof codexReasoningEffortSchema>

const codexModelSchema = z.string().trim().min(1, 'Codex model is required')
const claudeCodeModelSchema = z.string().trim().min(1, 'Claude Code model is required')
const apiKeySchema = z.string().trim().min(1, 'API key is required')
const authJsonSchema = z.object({}).catchall(z.unknown())

export const codexAuthJsonSettingsSchema = z
  .object({
    authMode: z.literal('auth-json'),
    authJson: authJsonSchema,
    model: codexModelSchema,
    reasoningEffort: codexReasoningEffortSchema,
  })
  .strict()

export const codexApiKeySettingsSchema = z
  .object({
    authMode: z.literal('api-key'),
    apiKey: apiKeySchema,
    model: codexModelSchema,
    reasoningEffort: codexReasoningEffortSchema,
  })
  .strict()

export const codexCodingAgentSettingsSchema = z.discriminatedUnion('authMode', [
  codexAuthJsonSettingsSchema,
  codexApiKeySettingsSchema,
])
export type CodexCodingAgentSettings = z.infer<typeof codexCodingAgentSettingsSchema>

export const claudeCodeCodingAgentSettingsSchema = z
  .object({
    apiKey: apiKeySchema,
    model: claudeCodeModelSchema,
  })
  .strict()
export type ClaudeCodeCodingAgentSettings = z.infer<typeof claudeCodeCodingAgentSettingsSchema>

export const codexCodingAgentManagementSettingsSchema = z
  .object({
    model: codexModelSchema,
    reasoningEffort: codexReasoningEffortSchema,
    hasCredential: z.boolean(),
  })
  .strict()
export type CodexCodingAgentManagementSettings = z.infer<typeof codexCodingAgentManagementSettingsSchema>

export const claudeCodeCodingAgentManagementSettingsSchema = z
  .object({
    model: claudeCodeModelSchema,
    hasCredential: z.boolean(),
  })
  .strict()
export type ClaudeCodeCodingAgentManagementSettings = z.infer<typeof claudeCodeCodingAgentManagementSettingsSchema>

export const createCodexCodingAgentManagementSettingsSchema = z
  .object({
    apiKey: apiKeySchema,
    model: codexModelSchema,
    reasoningEffort: codexReasoningEffortSchema,
  })
  .strict()
export type CreateCodexCodingAgentManagementSettings = z.infer<typeof createCodexCodingAgentManagementSettingsSchema>

export const updateCodexCodingAgentManagementSettingsSchema = z
  .object({
    apiKey: apiKeySchema.optional(),
    model: codexModelSchema,
    reasoningEffort: codexReasoningEffortSchema,
  })
  .strict()
export type UpdateCodexCodingAgentManagementSettings = z.infer<typeof updateCodexCodingAgentManagementSettingsSchema>

export const codingAgentSettingsSchemaByType = {
  codex: codexCodingAgentSettingsSchema,
  'claude-code': claudeCodeCodingAgentSettingsSchema,
} as const

export const codingAgentManagementSettingsSchemaByType = {
  codex: codexCodingAgentManagementSettingsSchema,
  'claude-code': claudeCodeCodingAgentManagementSettingsSchema,
} as const

export type CodingAgentSettingsByType = {
  codex: CodexCodingAgentSettings
  'claude-code': ClaudeCodeCodingAgentSettings
}

export type CodingAgentSettings<TType extends CodingAgentType = CodingAgentType> = CodingAgentSettingsByType[TType]

export type CodingAgentManagementSettingsByType = {
  codex: CodexCodingAgentManagementSettings
  'claude-code': ClaudeCodeCodingAgentManagementSettings
}

export type CodingAgentManagementSettings<TType extends CodingAgentType = CodingAgentType> =
  CodingAgentManagementSettingsByType[TType]

export type CreateCodingAgentManagementSettingsByType = {
  codex: CreateCodexCodingAgentManagementSettings
}

export type CreateCodingAgentManagementSettings<
  TType extends ConfigurableCodingAgentType = ConfigurableCodingAgentType,
> = CreateCodingAgentManagementSettingsByType[TType]

export type UpdateCodingAgentManagementSettingsByType = {
  codex: UpdateCodexCodingAgentManagementSettings
}

export type UpdateCodingAgentManagementSettings<
  TType extends ConfigurableCodingAgentType = ConfigurableCodingAgentType,
> = UpdateCodingAgentManagementSettingsByType[TType]

export interface CodingAgentDefinition<TType extends CodingAgentType = CodingAgentType> {
  type: TType
  label: string
  description: string
  managementAvailability: CodingAgentManagementAvailability
}

export const CODING_AGENT_DEFINITIONS = [
  {
    type: 'codex',
    label: 'Codex',
    description: 'Configure Codex execution with an API key, model, and reasoning effort.',
    managementAvailability: 'available',
  },
  {
    type: 'claude-code',
    label: 'Claude Code',
    description: 'Claude Code configuration is planned, but not yet available in Settings.',
    managementAvailability: 'coming-soon',
  },
] as const satisfies readonly CodingAgentDefinition[]

export const getCodingAgentDefinition = (type: CodingAgentType): CodingAgentDefinition =>
  CODING_AGENT_DEFINITIONS.find(definition => definition.type === type) ?? {
    type,
    label: type,
    description: '',
    managementAvailability: 'coming-soon',
  }

export const isConfigurableCodingAgentType = (type: CodingAgentType): type is ConfigurableCodingAgentType =>
  configurableCodingAgentTypeSchema.safeParse(type).success

export interface CodingAgentSummary<TType extends CodingAgentType = CodingAgentType> {
  id: string
  name: string
  type: TType
  settings: CodingAgentSettings<TType>
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export type CodingAgentDetail<TType extends CodingAgentType = CodingAgentType> = CodingAgentSummary<TType>

export interface CodingAgentManagementSummary<TType extends CodingAgentType = CodingAgentType> {
  id: string
  name: string
  type: TType
  settings: CodingAgentManagementSettings<TType>
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export type CodingAgentManagementDetail<TType extends CodingAgentType = CodingAgentType> =
  CodingAgentManagementSummary<TType>

export interface CreateCodingAgentManagementInput<
  TType extends ConfigurableCodingAgentType = ConfigurableCodingAgentType,
> {
  name: string
  type: TType
  settings: CreateCodingAgentManagementSettings<TType>
  isDefault?: boolean
}

export interface UpdateCodingAgentManagementInput<
  TType extends ConfigurableCodingAgentType = ConfigurableCodingAgentType,
> {
  name?: string
  settings?: UpdateCodingAgentManagementSettings<TType>
  isDefault?: boolean
}

export interface CreateCodingAgentInput<TType extends CodingAgentType = CodingAgentType> {
  name: string
  type: TType
  settings: CodingAgentSettings<TType>
  isDefault?: boolean
}

export interface UpdateCodingAgentInput<TType extends CodingAgentType = CodingAgentType> {
  name?: string
  type?: TType
  settings?: CodingAgentSettings<TType>
  isDefault?: boolean
}

export interface CreateCodingAgentResponseDto {
  codingAgent: CodingAgentManagementDetail
}

export interface UpdateCodingAgentResponseDto {
  codingAgent: CodingAgentManagementDetail
}

export interface GetCodingAgentResponseDto {
  codingAgent: CodingAgentManagementDetail
}

export interface GetCodingAgentsResponseDto {
  codingAgents: CodingAgentManagementSummary[]
}

export const normalizeCodingAgentName = (raw: string): string => {
  const name = raw.trim()
  if (!name) {
    throw new Error('Coding agent name is required.')
  }
  if (name.length > codingAgentNameMaxLength) {
    throw new Error(`Coding agent name must be at most ${codingAgentNameMaxLength} characters.`)
  }
  return name
}

const sortObjectEntries = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)))

export const normalizeCodexCodingAgentSettings = (
  settings: CodexCodingAgentSettings | null | undefined,
): CodexCodingAgentSettings | null => {
  if (!settings) {
    return null
  }

  if (settings.authMode === 'auth-json') {
    return {
      authMode: 'auth-json',
      authJson: sortObjectEntries(settings.authJson),
      model: settings.model.trim(),
      reasoningEffort: settings.reasoningEffort,
    }
  }

  return {
    authMode: 'api-key',
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim(),
    reasoningEffort: settings.reasoningEffort,
  }
}

export const normalizeClaudeCodeCodingAgentSettings = (
  settings: ClaudeCodeCodingAgentSettings | null | undefined,
): ClaudeCodeCodingAgentSettings | null => {
  if (!settings) {
    return null
  }

  return {
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim(),
  }
}

export const normalizeCodingAgentSettings = <TType extends CodingAgentType>(
  type: TType,
  settings: CodingAgentSettings<TType> | null | undefined,
): CodingAgentSettings<TType> | null => {
  if (!settings) {
    return null
  }

  if (type === 'codex') {
    return normalizeCodexCodingAgentSettings(settings as CodingAgentSettings<'codex'>) as CodingAgentSettings<TType>
  }

  return normalizeClaudeCodeCodingAgentSettings(
    settings as CodingAgentSettings<'claude-code'>,
  ) as CodingAgentSettings<TType>
}

export const parseCodingAgentSettings = <TType extends CodingAgentType>(
  type: TType,
  value: unknown,
): CodingAgentSettings<TType> | null => {
  const schema = codingAgentSettingsSchemaByType[type]
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    return null
  }

  return normalizeCodingAgentSettings(type, parsed.data as CodingAgentSettings<TType>)
}
