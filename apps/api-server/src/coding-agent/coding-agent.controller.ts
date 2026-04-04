import { z } from 'zod'

import { AuthWorkspaceId } from '@/auth/decorators/organization.decorator'
import { makeSuccessResponse } from '@/common/responses/api-response'
import { zodParse } from '@/common/zod/zod-parse'
import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common'
import {
  ClaudeCodeCodingAgentSettings,
  CodexCodingAgentSettings,
  CodingAgentDetail,
  CodingAgentManagementDetail,
  configurableCodingAgentTypeSchema,
  CreateCodexCodingAgentManagementSettings,
  createCodexCodingAgentManagementSettingsSchema,
  CreateCodingAgentInput,
  CreateCodingAgentManagementInput,
  UpdateCodexCodingAgentManagementSettings,
  updateCodexCodingAgentManagementSettingsSchema,
  UpdateCodingAgentInput,
  UpdateCodingAgentManagementInput,
} from '@repo/shared'
import { Session, UserSession } from '@thallesp/nestjs-better-auth'
import { CodingAgentService } from './coding-agent.service'
import {
  CreateCodingAgentDto,
  CreateCodingAgentResponseDto,
  GetCodingAgentResponseDto,
  GetCodingAgentsResponseDto,
  UpdateCodingAgentDto,
  UpdateCodingAgentResponseDto,
} from './types/coding-agent.types'

const toManagementCodingAgentDetail = (codingAgent: CodingAgentDetail): CodingAgentManagementDetail => {
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

  const settings = codingAgent.settings as ClaudeCodeCodingAgentSettings

  return {
    ...codingAgent,
    settings: {
      model: settings.model,
      hasCredential: settings.apiKey.trim().length > 0,
    },
  }
}

const toCreateCodingAgentInput = (codingAgent: CreateCodingAgentManagementInput): CreateCodingAgentInput => {
  if (codingAgent.type === 'codex') {
    const settings = codingAgent.settings as CreateCodexCodingAgentManagementSettings

    return {
      name: codingAgent.name,
      type: 'codex',
      settings: {
        authMode: 'api-key',
        apiKey: settings.apiKey,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
      },
      isDefault: codingAgent.isDefault,
    }
  }

  throw new BadRequestException(`Coding agent type "${codingAgent.type}" is not configurable yet.`)
}

const mergeCodexManagementSettings = (
  existingSettings: CodexCodingAgentSettings,
  inputSettings: UpdateCodexCodingAgentManagementSettings,
): CodexCodingAgentSettings => {
  const trimmedApiKey = inputSettings.apiKey?.trim()
  if (trimmedApiKey) {
    return {
      authMode: 'api-key',
      apiKey: trimmedApiKey,
      model: inputSettings.model,
      reasoningEffort: inputSettings.reasoningEffort,
    }
  }

  if (existingSettings.authMode === 'auth-json') {
    return {
      authMode: 'auth-json',
      authJson: existingSettings.authJson,
      model: inputSettings.model,
      reasoningEffort: inputSettings.reasoningEffort,
    }
  }

  return {
    authMode: 'api-key',
    apiKey: existingSettings.apiKey,
    model: inputSettings.model,
    reasoningEffort: inputSettings.reasoningEffort,
  }
}

const toUpdateCodingAgentInput = (
  existingCodingAgent: CodingAgentDetail,
  codingAgent: UpdateCodingAgentManagementInput,
): UpdateCodingAgentInput => {
  const nextInput: UpdateCodingAgentInput = {}

  if ('name' in codingAgent && codingAgent.name !== undefined) {
    nextInput.name = codingAgent.name
  }

  if ('isDefault' in codingAgent && codingAgent.isDefault !== undefined) {
    nextInput.isDefault = codingAgent.isDefault
  }

  if ('settings' in codingAgent && codingAgent.settings !== undefined) {
    if (existingCodingAgent.type !== 'codex') {
      throw new BadRequestException(`Coding agent type "${existingCodingAgent.type}" is not configurable yet.`)
    }

    nextInput.settings = mergeCodexManagementSettings(
      existingCodingAgent.settings as CodexCodingAgentSettings,
      codingAgent.settings as UpdateCodexCodingAgentManagementSettings,
    )
  }

  return nextInput
}

const CreateCodingAgentSchema = z.object({
  codingAgent: z
    .object({
      name: z.string(),
      type: configurableCodingAgentTypeSchema,
      settings: createCodexCodingAgentManagementSettingsSchema,
      isDefault: z.boolean().optional(),
    })
    .strict(),
})

const UpdateCodingAgentSchema = z.object({
  codingAgent: z
    .object({
      name: z.string().optional(),
      settings: updateCodexCodingAgentManagementSettingsSchema.optional(),
      isDefault: z.boolean().optional(),
    })
    .strict()
    .refine(payload => Object.keys(payload).length > 0, {
      message: 'At least one updatable field is required.',
    }),
})

@Controller('api/v1/coding-agents')
export class CodingAgentController {
  constructor(private readonly codingAgentService: CodingAgentService) {}

  @Get()
  async getCodingAgents(@AuthWorkspaceId() workspaceId: string, @Session() session: UserSession) {
    const codingAgents = await this.codingAgentService.getCodingAgents(session.user.id, workspaceId)

    return makeSuccessResponse<GetCodingAgentsResponseDto>({
      codingAgents: codingAgents.map(toManagementCodingAgentDetail),
    })
  }

  @Get(':id')
  async getCodingAgent(
    @Param('id') codingAgentId: string,
    @AuthWorkspaceId() workspaceId: string,
    @Session() session: UserSession,
  ) {
    const codingAgent = await this.codingAgentService.getCodingAgentById(session.user.id, workspaceId, codingAgentId)

    return makeSuccessResponse<GetCodingAgentResponseDto>({
      codingAgent: toManagementCodingAgentDetail(codingAgent),
    })
  }

  @Post()
  async createCodingAgent(
    @Body() bodyRaw: unknown,
    @AuthWorkspaceId() workspaceId: string,
    @Session() session: UserSession,
  ) {
    const body = zodParse(CreateCodingAgentSchema, bodyRaw) satisfies CreateCodingAgentDto
    const codingAgent = await this.codingAgentService.createCodingAgent(
      session.user.id,
      workspaceId,
      toCreateCodingAgentInput(body.codingAgent),
    )

    return makeSuccessResponse<CreateCodingAgentResponseDto>({
      codingAgent: toManagementCodingAgentDetail(codingAgent),
    })
  }

  @Put(':id')
  async updateCodingAgent(
    @Param('id') codingAgentId: string,
    @Body() bodyRaw: unknown,
    @AuthWorkspaceId() workspaceId: string,
    @Session() session: UserSession,
  ) {
    const body = zodParse(UpdateCodingAgentSchema, bodyRaw) satisfies UpdateCodingAgentDto
    const existingCodingAgent = await this.codingAgentService.getCodingAgentById(
      session.user.id,
      workspaceId,
      codingAgentId,
    )
    const codingAgent = await this.codingAgentService.updateCodingAgent(
      session.user.id,
      workspaceId,
      codingAgentId,
      toUpdateCodingAgentInput(existingCodingAgent, body.codingAgent),
    )

    return makeSuccessResponse<UpdateCodingAgentResponseDto>({
      codingAgent: toManagementCodingAgentDetail(codingAgent),
    })
  }

  @Delete(':id')
  async deleteCodingAgent(
    @Param('id') codingAgentId: string,
    @AuthWorkspaceId() workspaceId: string,
    @Session() session: UserSession,
  ) {
    await this.codingAgentService.deleteCodingAgent(session.user.id, workspaceId, codingAgentId)

    return makeSuccessResponse(null)
  }
}
