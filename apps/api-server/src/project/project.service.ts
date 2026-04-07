import { AuthService } from '@/auth/auth.service'
import { PrismaService } from '@/database/prisma.service'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@repo/database'
import { normalizeGithubRepoUrl } from '@repo/shared'
import {
  CreateProjectInput,
  normalizeProjectEnvConfig,
  normalizeProjectMcpConfig,
  normalizeProjectValidationCommands,
  parseProjectEnvConfig,
  parseProjectMcpConfig,
  parseProjectValidationCommands,
  ProjectDetail,
  ProjectEnvConfig,
  ProjectMcpConfig,
  ProjectSummary,
  UpdateProjectInput,
} from '@repo/shared/project/types'

const PROJECT_NAME_MAX_LENGTH = 120
const PROJECT_BRANCH_MAX_LENGTH = 255
const PREVIEW_COMMAND_MAX_LENGTH = 2000

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async getProjects(workspaceId: string): Promise<ProjectSummary[]> {
    const projects = await this.prisma.client.project.findMany({
      where: {
        workspace_id: workspaceId,
        deleted_at: null,
      },
      orderBy: [{ name: 'asc' }, { created_at: 'desc' }],
    })

    return projects.map(project => this.toProjectSummary(project))
  }

  async getProjectById(workspaceId: string, projectId: string): Promise<ProjectDetail> {
    const project = await this.prisma.client.project.findFirst({
      where: {
        id: projectId,
        workspace_id: workspaceId,
        deleted_at: null,
      },
    })

    if (!project) {
      throw new NotFoundException('Project does not exist.')
    }

    return this.toProjectDetail(project)
  }

  async createProject(workspaceId: string, userId: string, input: CreateProjectInput): Promise<ProjectDetail> {
    const hasPermission = await this.auth.checkUserPermission(workspaceId, userId, this.auth.CREATE_ISSUE_PERMISSION)
    if (!hasPermission) {
      throw new ForbiddenException('No access to create projects')
    }

    const normalizedInput = this.normalizeCreateInput(input)

    const existingProject = await this.prisma.client.project.findFirst({
      where: {
        workspace_id: workspaceId,
        github_repo_url: normalizedInput.githubRepoUrl,
        deleted_at: null,
      },
      select: { id: true },
    })

    if (existingProject) {
      throw new BadRequestException('A project for this repository already exists in the workspace.')
    }

    const project = await this.prisma.client.project.create({
      data: {
        workspace_id: workspaceId,
        name: normalizedInput.name,
        github_repo_url: normalizedInput.githubRepoUrl,
        repo_base_branch: normalizedInput.repoBaseBranch,
        check_ci_cd: normalizedInput.checkCiCd,
        preview_commands: normalizedInput.previewCommands,
        validation_commands: normalizedInput.validationCommands,
        mcp_config: this.serializeProjectMcpConfig(normalizedInput.mcpConfig),
        env_config: this.serializeProjectEnvConfig(normalizedInput.envConfig),
        created_by: userId,
      },
    })

    return this.toProjectDetail(project)
  }

  async updateProject(
    workspaceId: string,
    userId: string,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<ProjectDetail> {
    const hasPermission = await this.auth.checkUserPermission(workspaceId, userId, this.auth.UPDATE_ISSUE_PERMISSION)
    if (!hasPermission) {
      throw new ForbiddenException('No access to update projects')
    }

    const existingProject = await this.prisma.client.project.findFirst({
      where: {
        id: projectId,
        workspace_id: workspaceId,
        deleted_at: null,
      },
    })

    if (!existingProject) {
      throw new NotFoundException('Project does not exist.')
    }

    const normalizedInput = this.normalizeUpdateInput(input)

    const project = await this.prisma.client.project.update({
      where: {
        id: projectId,
      },
      data: normalizedInput,
    })

    return this.toProjectDetail(project)
  }

  async checkProjectExists(workspaceId: string, projectId: string): Promise<boolean> {
    if (!projectId) {
      return false
    }

    const count = await this.prisma.client.project.count({
      where: {
        id: projectId,
        workspace_id: workspaceId,
        deleted_at: null,
      },
    })

    return count > 0
  }

  private toProjectSummary(project: {
    id: string
    name: string
    github_repo_url: string
    repo_base_branch: string
    check_ci_cd: boolean
    preview_commands: unknown
    validation_commands?: unknown
    created_at: Date
    updated_at: Date
  }): ProjectSummary {
    return {
      id: project.id,
      name: project.name,
      githubRepoUrl: project.github_repo_url,
      repoBaseBranch: project.repo_base_branch,
      checkCiCd: project.check_ci_cd,
      previewCommands: this.parsePreviewCommands(project.preview_commands),
      validationCommands: parseProjectValidationCommands(project.validation_commands),
      createdAt: project.created_at.toISOString(),
      updatedAt: project.updated_at.toISOString(),
    }
  }

  private toProjectDetail(project: {
    id: string
    workspace_id: string
    name: string
    github_repo_url: string
    repo_base_branch: string
    check_ci_cd: boolean
    preview_commands: unknown
    validation_commands?: unknown
    mcp_config: unknown
    env_config: unknown
    created_by: string
    created_at: Date
    updated_at: Date
  }): ProjectDetail {
    return {
      ...this.toProjectSummary(project),
      workspaceId: project.workspace_id,
      createdBy: project.created_by,
      mcpConfig: parseProjectMcpConfig(project.mcp_config),
      envConfig: parseProjectEnvConfig(project.env_config),
    }
  }

  private normalizeCreateInput(input: CreateProjectInput): {
    name: string
    githubRepoUrl: string
    repoBaseBranch: string
    checkCiCd: boolean
    previewCommands: string[]
    validationCommands: string[]
    mcpConfig: ProjectMcpConfig | null
    envConfig: ProjectEnvConfig | null
  } {
    return {
      name: this.normalizeName(input.name),
      githubRepoUrl: this.normalizeGithubRepoUrl(input.githubRepoUrl),
      repoBaseBranch: this.normalizeBranch(input.repoBaseBranch),
      checkCiCd: Boolean(input.checkCiCd),
      previewCommands: this.normalizePreviewCommands(input.previewCommands),
      validationCommands: this.normalizeValidationCommands(input.validationCommands),
      mcpConfig: normalizeProjectMcpConfig(input.mcpConfig),
      envConfig: normalizeProjectEnvConfig(input.envConfig),
    }
  }

  private normalizeUpdateInput(input: UpdateProjectInput): {
    name?: string
    check_ci_cd?: boolean
    preview_commands?: string[]
    validation_commands?: string[] | Prisma.NullableJsonNullValueInput
    mcp_config?: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue
    env_config?: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue
  } {
    const data: {
      name?: string
      check_ci_cd?: boolean
      preview_commands?: string[]
      validation_commands?: string[] | Prisma.NullableJsonNullValueInput
      mcp_config?: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue
      env_config?: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue
    } = {}

    if ('name' in input && input.name !== undefined) {
      data.name = this.normalizeName(input.name)
    }
    if ('checkCiCd' in input && input.checkCiCd !== undefined) {
      data.check_ci_cd = Boolean(input.checkCiCd)
    }
    if ('previewCommands' in input && input.previewCommands !== undefined) {
      data.preview_commands = this.normalizePreviewCommands(input.previewCommands)
    }
    if ('validationCommands' in input) {
      const commands = this.normalizeValidationCommands(input.validationCommands ?? null)
      data.validation_commands = commands.length > 0 ? commands : Prisma.DbNull
    }
    if ('mcpConfig' in input) {
      data.mcp_config = this.serializeProjectMcpConfig(input.mcpConfig ?? null)
    }
    if ('envConfig' in input) {
      data.env_config = this.serializeProjectEnvConfig(input.envConfig ?? null)
    }

    return data
  }

  private normalizeName(raw: string): string {
    const name = raw.trim()
    if (!name) {
      throw new BadRequestException('Project name is required.')
    }
    if (name.length > PROJECT_NAME_MAX_LENGTH) {
      throw new BadRequestException(`Project name must be at most ${PROJECT_NAME_MAX_LENGTH} characters.`)
    }
    return name
  }

  private normalizeBranch(raw: string): string {
    const branch = raw.trim()
    if (!branch) {
      throw new BadRequestException('Repository base branch is required.')
    }
    if (branch.length > PROJECT_BRANCH_MAX_LENGTH) {
      throw new BadRequestException(`Repository base branch must be at most ${PROJECT_BRANCH_MAX_LENGTH} characters.`)
    }
    return branch
  }

  private normalizeGithubRepoUrl(raw: string): string {
    if (!raw.trim()) {
      throw new BadRequestException('GitHub repository URL is required.')
    }

    const normalizedUrl = normalizeGithubRepoUrl(raw)
    if (!normalizedUrl) {
      throw new BadRequestException('GitHub repository URL must be a valid github.com repository URL or SSH path.')
    }

    return normalizedUrl
  }

  private normalizePreviewCommands(raw: string[] | undefined): string[] {
    if (!raw) {
      return []
    }

    if (!Array.isArray(raw)) {
      throw new BadRequestException('Preview commands must be an array of strings.')
    }

    return raw.map((command, index) => {
      const normalized = command.trim()
      if (!normalized) {
        throw new BadRequestException(`Preview command at index ${index} must not be empty.`)
      }
      if (normalized.length > PREVIEW_COMMAND_MAX_LENGTH) {
        throw new BadRequestException(
          `Preview command at index ${index} must be at most ${PREVIEW_COMMAND_MAX_LENGTH} characters.`,
        )
      }
      return normalized
    })
  }

  private parsePreviewCommands(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return []
    }

    return value.filter((item): item is string => typeof item === 'string')
  }

  private normalizeValidationCommands(raw: string[] | null | undefined): string[] {
    if (raw === null || raw === undefined) {
      return []
    }

    if (!Array.isArray(raw)) {
      throw new BadRequestException('Validation commands must be an array of strings.')
    }

    const normalized = normalizeProjectValidationCommands(raw)
    if (normalized.length !== raw.length) {
      throw new BadRequestException('Validation commands must be non-empty strings.')
    }

    return normalized
  }

  private serializeProjectMcpConfig(
    config: ProjectMcpConfig | null | undefined,
  ): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
    const normalizedConfig = normalizeProjectMcpConfig(config)
    if (!normalizedConfig) {
      return Prisma.DbNull
    }

    return normalizedConfig as unknown as Prisma.InputJsonValue
  }

  private serializeProjectEnvConfig(
    config: ProjectEnvConfig | null | undefined,
  ): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
    // TODO: Store project environment variables with proper secret protection instead of plain JSON.
    const normalizedConfig = normalizeProjectEnvConfig(config)
    if (!normalizedConfig) {
      return Prisma.DbNull
    }

    return normalizedConfig as unknown as Prisma.InputJsonValue
  }
}
