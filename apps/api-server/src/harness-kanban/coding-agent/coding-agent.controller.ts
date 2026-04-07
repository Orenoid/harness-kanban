import { z } from 'zod'

import { AuthWorkspaceId } from '@/auth/decorators/organization.decorator'
import { makeSuccessResponse } from '@/common/responses/api-response'
import { zodParse } from '@/common/zod/zod-parse'
import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common'
import { configurableCodingAgentTypeSchema } from '@repo/shared'
import { Session, UserSession } from '@thallesp/nestjs-better-auth'
import { CodingAgentManagementRegistry } from './coding-agent-management.registry'
import { CodingAgentService } from './coding-agent.service'
import {
  CreateCodingAgentResponseDto,
  GetCodingAgentResponseDto,
  GetCodingAgentsResponseDto,
  UpdateCodingAgentResponseDto,
} from './types/coding-agent.types'

const CreateCodingAgentSchema = z.object({
  codingAgent: z
    .object({
      name: z.string(),
      type: configurableCodingAgentTypeSchema,
      settings: z.unknown(),
      isDefault: z.boolean().optional(),
    })
    .strict(),
})

const UpdateCodingAgentSchema = z.object({
  codingAgent: z
    .object({
      name: z.string().optional(),
      settings: z.unknown().optional(),
      isDefault: z.boolean().optional(),
    })
    .strict()
    .refine(payload => Object.keys(payload).length > 0, {
      message: 'At least one updatable field is required.',
    }),
})

@Controller('api/v1/coding-agents')
export class CodingAgentController {
  constructor(
    private readonly codingAgentService: CodingAgentService,
    private readonly codingAgentManagementRegistry: CodingAgentManagementRegistry,
  ) {}

  @Get()
  async getCodingAgents(@AuthWorkspaceId() workspaceId: string, @Session() session: UserSession) {
    const codingAgents = await this.codingAgentService.getCodingAgents(session.user.id, workspaceId)

    return makeSuccessResponse<GetCodingAgentsResponseDto>({
      codingAgents: codingAgents.map(codingAgent => this.codingAgentManagementRegistry.toManagementDetail(codingAgent)),
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
      codingAgent: this.codingAgentManagementRegistry.toManagementDetail(codingAgent),
    })
  }

  @Post()
  async createCodingAgent(
    @Body() bodyRaw: unknown,
    @AuthWorkspaceId() workspaceId: string,
    @Session() session: UserSession,
  ) {
    const body = zodParse(CreateCodingAgentSchema, bodyRaw)
    const codingAgent = await this.codingAgentService.createCodingAgent(
      session.user.id,
      workspaceId,
      this.codingAgentManagementRegistry.toCreateInput(body.codingAgent),
    )

    return makeSuccessResponse<CreateCodingAgentResponseDto>({
      codingAgent: this.codingAgentManagementRegistry.toManagementDetail(codingAgent),
    })
  }

  @Put(':id')
  async updateCodingAgent(
    @Param('id') codingAgentId: string,
    @Body() bodyRaw: unknown,
    @AuthWorkspaceId() workspaceId: string,
    @Session() session: UserSession,
  ) {
    const body = zodParse(UpdateCodingAgentSchema, bodyRaw)
    const existingCodingAgent = await this.codingAgentService.getCodingAgentById(
      session.user.id,
      workspaceId,
      codingAgentId,
    )
    const codingAgent = await this.codingAgentService.updateCodingAgent(
      session.user.id,
      workspaceId,
      codingAgentId,
      this.codingAgentManagementRegistry.toUpdateInput(existingCodingAgent, body.codingAgent),
    )

    return makeSuccessResponse<UpdateCodingAgentResponseDto>({
      codingAgent: this.codingAgentManagementRegistry.toManagementDetail(codingAgent),
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
