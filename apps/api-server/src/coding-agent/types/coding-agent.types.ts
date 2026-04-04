import {
  CreateCodingAgentManagementInput,
  CreateCodingAgentResponseDto as SharedCreateCodingAgentResponseDto,
  GetCodingAgentResponseDto as SharedGetCodingAgentResponseDto,
  GetCodingAgentsResponseDto as SharedGetCodingAgentsResponseDto,
  UpdateCodingAgentResponseDto as SharedUpdateCodingAgentResponseDto,
  UpdateCodingAgentManagementInput,
} from '@repo/shared'

export interface CreateCodingAgentDto {
  codingAgent: CreateCodingAgentManagementInput
}

export interface UpdateCodingAgentDto {
  codingAgent: UpdateCodingAgentManagementInput
}

export type CreateCodingAgentResponseDto = SharedCreateCodingAgentResponseDto
export type GetCodingAgentResponseDto = SharedGetCodingAgentResponseDto
export type GetCodingAgentsResponseDto = SharedGetCodingAgentsResponseDto
export type UpdateCodingAgentResponseDto = SharedUpdateCodingAgentResponseDto
