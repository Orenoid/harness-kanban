import { z } from 'zod'

const projectMcpServerNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const projectEnvVarNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/
const projectCommandMaxLength = 2000

export const projectMcpStreamableHttpServerSchema = z
  .object({
    type: z.literal('streamable-http'),
    url: z.string().trim().url('MCP server URL must be a valid URL'),
  })
  .strict()

export const projectMcpStdioServerSchema = z
  .object({
    type: z.literal('stdio'),
    command: z.string().trim().min(1, 'MCP stdio command is required'),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict()

export const projectMcpServerSchema = z.discriminatedUnion('type', [
  projectMcpStreamableHttpServerSchema,
  projectMcpStdioServerSchema,
])

export const projectMcpConfigSchema = z.record(z.string(), projectMcpServerSchema).superRefine((config, ctx) => {
  for (const name of Object.keys(config)) {
    if (!projectMcpServerNamePattern.test(name)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'MCP server names must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens.',
        path: [name],
      })
    }
  }
})

export type ProjectMcpServerConfig = z.infer<typeof projectMcpServerSchema>
export type ProjectMcpConfig = z.infer<typeof projectMcpConfigSchema>

export const projectEnvConfigSchema = z.record(z.string(), z.string()).superRefine((config, ctx) => {
  const normalizedNames = new Set<string>()

  for (const name of Object.keys(config)) {
    const trimmedName = name.trim()
    if (!trimmedName) {
      ctx.addIssue({
        code: 'custom',
        message: 'Environment variable names must not be empty.',
        path: [name],
      })
      continue
    }

    if (!projectEnvVarNamePattern.test(trimmedName)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Environment variable names must start with a letter or underscore and contain only letters, numbers, or underscores.',
        path: [name],
      })
      continue
    }

    if (normalizedNames.has(trimmedName)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Environment variable names must be unique after trimming whitespace.',
        path: [name],
      })
      continue
    }

    normalizedNames.add(trimmedName)
  }
})

export type ProjectEnvConfig = z.infer<typeof projectEnvConfigSchema>

export const projectValidationCommandsSchema = z.array(z.string()).superRefine((commands, ctx) => {
  commands.forEach((command, index) => {
    const normalized = command.trim()
    if (!normalized) {
      ctx.addIssue({
        code: 'custom',
        message: `Validation command at index ${index} must not be empty.`,
        path: [index],
      })
      return
    }

    if (normalized.length > projectCommandMaxLength) {
      ctx.addIssue({
        code: 'custom',
        message: `Validation command at index ${index} must be at most ${projectCommandMaxLength} characters.`,
        path: [index],
      })
    }
  })
})

export type ProjectValidationCommands = z.infer<typeof projectValidationCommandsSchema>

export const normalizeProjectMcpConfig = (config: ProjectMcpConfig | null | undefined): ProjectMcpConfig | null => {
  if (!config) {
    return null
  }

  const entries = Object.entries(config)
  if (entries.length === 0) {
    return null
  }

  return Object.fromEntries(
    entries
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
      .map(([name, serverConfig]) => {
        if (serverConfig.type === 'streamable-http') {
          return [
            name,
            {
              type: 'streamable-http',
              url: serverConfig.url.trim(),
            } satisfies ProjectMcpServerConfig,
          ]
        }

        const normalizedEnvEntries = Object.entries(serverConfig.env ?? {})
          .filter(([envKey]) => envKey.trim().length > 0)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))

        return [
          name,
          {
            type: 'stdio',
            command: serverConfig.command.trim(),
            ...(serverConfig.args && serverConfig.args.length > 0
              ? { args: serverConfig.args.map(arg => arg.trim()).filter(Boolean) }
              : {}),
            ...(normalizedEnvEntries.length > 0 ? { env: Object.fromEntries(normalizedEnvEntries) } : {}),
          } satisfies ProjectMcpServerConfig,
        ]
      }),
  )
}

export const parseProjectMcpConfig = (value: unknown): ProjectMcpConfig | null => {
  if (value === null || value === undefined) {
    return null
  }

  const parsed = projectMcpConfigSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }

  return normalizeProjectMcpConfig(parsed.data)
}

export const normalizeProjectEnvConfig = (config: ProjectEnvConfig | null | undefined): ProjectEnvConfig | null => {
  if (!config) {
    return null
  }

  const entries = Object.entries(config)
    .map(([name, value]) => [name.trim(), value.trim()] as const)
    .filter(([name]) => name.length > 0)

  if (entries.length === 0) {
    return null
  }

  return Object.fromEntries(entries.sort(([leftName], [rightName]) => leftName.localeCompare(rightName)))
}

export const parseProjectEnvConfig = (value: unknown): ProjectEnvConfig | null => {
  if (value === null || value === undefined) {
    return null
  }

  const parsed = projectEnvConfigSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }

  return normalizeProjectEnvConfig(parsed.data)
}

export const normalizeProjectValidationCommands = (
  commands: ProjectValidationCommands | null | undefined,
): ProjectValidationCommands => {
  if (!commands) {
    return []
  }

  const parsed = projectValidationCommandsSchema.safeParse(commands)
  if (!parsed.success) {
    return []
  }

  return parsed.data.map(command => command.trim())
}

export const parseProjectValidationCommands = (value: unknown): ProjectValidationCommands => {
  if (value === null || value === undefined) {
    return []
  }

  const parsed = projectValidationCommandsSchema.safeParse(value)
  if (!parsed.success) {
    return []
  }

  return normalizeProjectValidationCommands(parsed.data)
}

export interface ProjectSummary {
  id: string
  name: string
  githubRepoUrl: string
  repoBaseBranch: string
  checkCiCd: boolean
  previewCommands: string[]
  validationCommands?: string[]
  createdAt: string
  updatedAt: string
}

export interface ProjectDetail extends ProjectSummary {
  workspaceId: string
  createdBy: string
  mcpConfig: ProjectMcpConfig | null
  envConfig: ProjectEnvConfig | null
}

export interface CreateProjectInput {
  name: string
  githubRepoUrl: string
  repoBaseBranch: string
  checkCiCd?: boolean
  previewCommands?: string[]
  validationCommands?: string[]
  mcpConfig?: ProjectMcpConfig
  envConfig?: ProjectEnvConfig
}

export interface UpdateProjectInput {
  name?: string
  checkCiCd?: boolean
  previewCommands?: string[]
  validationCommands?: string[] | null
  mcpConfig?: ProjectMcpConfig | null
  envConfig?: ProjectEnvConfig | null
}

export interface GetProjectsResponseDto {
  projects: ProjectSummary[]
}

export interface GetProjectResponseDto {
  project: ProjectDetail
}

export interface CreateProjectResponseDto {
  project: ProjectDetail
}

export interface UpdateProjectResponseDto {
  project: ProjectDetail
}
