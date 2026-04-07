import { z } from 'zod'

import { AuthWorkspaceId } from '@/auth/decorators/organization.decorator'
import { makeSuccessResponse } from '@/common/responses/api-response'
import { zodParse } from '@/common/zod/zod-parse'
import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common'
import {
  projectEnvConfigSchema,
  projectMcpConfigSchema,
  projectValidationCommandsSchema,
} from '@repo/shared/project/types'
import { Session, UserSession } from '@thallesp/nestjs-better-auth'
import { ProjectService } from './project.service'
import {
  CreateProjectDto,
  CreateProjectResponseDto,
  GetProjectResponseDto,
  GetProjectsResponseDto,
  UpdateProjectDto,
  UpdateProjectResponseDto,
} from './types/project.types'

const PreviewCommandsSchema = z.array(z.string()).optional()
const ValidationCommandsSchema = projectValidationCommandsSchema.optional()

const CreateProjectSchema = z.object({
  project: z
    .object({
      name: z.string(),
      githubRepoUrl: z.string(),
      repoBaseBranch: z.string(),
      checkCiCd: z.boolean().optional(),
      previewCommands: PreviewCommandsSchema,
      validationCommands: ValidationCommandsSchema,
      mcpConfig: projectMcpConfigSchema.optional(),
      envConfig: projectEnvConfigSchema.optional(),
    })
    .strict(),
})

const UpdateProjectSchema = z.object({
  project: z
    .object({
      name: z.string().optional(),
      checkCiCd: z.boolean().optional(),
      previewCommands: PreviewCommandsSchema,
      validationCommands: projectValidationCommandsSchema.nullable().optional(),
      mcpConfig: projectMcpConfigSchema.nullable().optional(),
      envConfig: projectEnvConfigSchema.nullable().optional(),
    })
    .strict()
    .refine(payload => Object.keys(payload).length > 0, {
      message: 'At least one updatable field is required.',
    }),
})

@Controller('api/v1/projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  async getProjects(@AuthWorkspaceId() workspaceId: string) {
    const projects = await this.projectService.getProjects(workspaceId)

    return makeSuccessResponse<GetProjectsResponseDto>({
      projects,
    })
  }

  @Post()
  async createProject(
    @Body() bodyRaw: unknown,
    @AuthWorkspaceId() workspaceId: string,
    @Session() session: UserSession,
  ) {
    const body = zodParse(CreateProjectSchema, bodyRaw) satisfies CreateProjectDto
    const project = await this.projectService.createProject(workspaceId, session.user.id, body.project)

    return makeSuccessResponse<CreateProjectResponseDto>({
      project,
    })
  }

  @Get(':id')
  async getProject(@Param('id') projectId: string, @AuthWorkspaceId() workspaceId: string) {
    const project = await this.projectService.getProjectById(workspaceId, projectId)

    return makeSuccessResponse<GetProjectResponseDto>({
      project,
    })
  }

  @Put(':id')
  async updateProject(
    @Param('id') projectId: string,
    @Body() bodyRaw: unknown,
    @AuthWorkspaceId() workspaceId: string,
    @Session() session: UserSession,
  ) {
    const body = zodParse(UpdateProjectSchema, bodyRaw) satisfies UpdateProjectDto
    const project = await this.projectService.updateProject(workspaceId, session.user.id, projectId, body.project)

    return makeSuccessResponse<UpdateProjectResponseDto>({
      project,
    })
  }
}
