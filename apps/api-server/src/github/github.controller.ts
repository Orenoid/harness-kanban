import { z } from 'zod'

import { AuthWorkspaceId } from '@/auth/decorators/organization.decorator'
import { makeSuccessResponse } from '@/common/responses/api-response'
import { zodParse } from '@/common/zod/zod-parse'
import { Body, Controller, Delete, Get, Put, Query } from '@nestjs/common'
import {
  DeleteGithubConnectionResponseDto,
  GetGithubBranchesResponseDto,
  GetGithubConnectionResponseDto,
  GetGithubRepositoriesResponseDto,
  UpdateGithubConnectionInput,
  UpdateGithubConnectionResponseDto,
} from '@repo/shared'
import { Session, UserSession } from '@thallesp/nestjs-better-auth'
import { GithubService } from './github.service'

const UpdateGithubConnectionSchema = z
  .object({
    token: z.string(),
  })
  .strict()

const GetGithubBranchesSchema = z.object({
  repository: z.string().trim().min(1, 'Repository is required.'),
})

@Controller('api/v1/github')
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  @Get('connection')
  async getConnection(@Session() _session: UserSession, @AuthWorkspaceId() workspaceId: string) {
    const connection = await this.githubService.getConnectionStatus(workspaceId)

    return makeSuccessResponse<GetGithubConnectionResponseDto>({
      connection,
    })
  }

  @Put('connection')
  async updateConnection(
    @Session() _session: UserSession,
    @AuthWorkspaceId() workspaceId: string,
    @Body() bodyRaw: unknown,
  ) {
    const body = zodParse(UpdateGithubConnectionSchema, bodyRaw) satisfies UpdateGithubConnectionInput
    const connection = await this.githubService.updateConnection(workspaceId, body)

    return makeSuccessResponse<UpdateGithubConnectionResponseDto>({
      connection,
    })
  }

  @Delete('connection')
  async deleteConnection(@Session() _session: UserSession, @AuthWorkspaceId() workspaceId: string) {
    const connection = await this.githubService.clearConnection(workspaceId)

    return makeSuccessResponse<DeleteGithubConnectionResponseDto>({
      connection,
    })
  }

  @Get('repositories')
  async getRepositories(@Session() _session: UserSession, @AuthWorkspaceId() workspaceId: string) {
    const repositories = await this.githubService.getRepositories(workspaceId)

    return makeSuccessResponse<GetGithubRepositoriesResponseDto>({
      repositories,
    })
  }

  @Get('branches')
  async getBranches(
    @Session() _session: UserSession,
    @AuthWorkspaceId() workspaceId: string,
    @Query() queryRaw: unknown,
  ) {
    const query = zodParse(GetGithubBranchesSchema, queryRaw)
    const branches = await this.githubService.getBranches(workspaceId, query.repository)

    return makeSuccessResponse<GetGithubBranchesResponseDto>({
      branches,
    })
  }
}
