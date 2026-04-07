import { PrismaService } from '@/database/prisma.service'
import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@repo/database'
import { CodingAgentDetail, CodingAgentExecutionState, parseCodingAgentExecutionState } from '@repo/shared'
import { CodingAgentService } from './coding-agent.service'

type IssueCodingAgentSnapshotRecord = {
  id: string
  issue_id: number
  source_coding_agent_id: string | null
  name: string
  type: string
  settings: unknown
  execution_state: unknown
  created_at: Date
  updated_at: Date
}

@Injectable()
export class CodingAgentSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codingAgentService: CodingAgentService,
  ) {}

  async ensureIssueCodingAgentSnapshot(issueId: number, workspaceId: string): Promise<CodingAgentDetail> {
    const existingSnapshot = await this.prisma.client.issue_coding_agent_snapshot.findUnique({
      where: {
        issue_id: issueId,
      },
    })

    if (existingSnapshot) {
      return this.toIssueCodingAgentSnapshot(existingSnapshot)
    }

    const codingAgent = await this.getPreferredCodingAgentForWorkspace(workspaceId)

    try {
      const snapshot = await this.prisma.client.issue_coding_agent_snapshot.create({
        data: {
          issue_id: issueId,
          source_coding_agent_id: codingAgent.id,
          name: codingAgent.name,
          type: codingAgent.type,
          settings: codingAgent.settings as unknown as Prisma.InputJsonValue,
          execution_state: Prisma.JsonNull,
        },
      })

      return this.toIssueCodingAgentSnapshot(snapshot)
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? (error as { code?: string }).code : null
      if (code !== 'P2002') {
        throw error
      }

      const snapshot = await this.prisma.client.issue_coding_agent_snapshot.findUnique({
        where: {
          issue_id: issueId,
        },
      })

      if (!snapshot) {
        throw error
      }

      return this.toIssueCodingAgentSnapshot(snapshot)
    }
  }

  async getIssueCodingAgentSnapshot(issueId: number): Promise<CodingAgentDetail | null> {
    const snapshot = await this.prisma.client.issue_coding_agent_snapshot.findUnique({
      where: {
        issue_id: issueId,
      },
    })

    return snapshot ? this.toIssueCodingAgentSnapshot(snapshot) : null
  }

  async getIssueCodingAgentExecutionState(issueId: number): Promise<CodingAgentExecutionState | null> {
    const snapshot = await this.prisma.client.issue_coding_agent_snapshot.findUnique({
      where: {
        issue_id: issueId,
      },
      select: {
        execution_state: true,
      },
    })

    return parseCodingAgentExecutionState(snapshot?.execution_state)
  }

  async updateIssueCodingAgentExecutionState(
    issueId: number,
    executionState: CodingAgentExecutionState | null,
  ): Promise<void> {
    const nextExecutionState =
      executionState && Object.keys(executionState).length > 0
        ? (executionState as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull

    await this.prisma.client.issue_coding_agent_snapshot.updateMany({
      where: {
        issue_id: issueId,
      },
      data: {
        execution_state: nextExecutionState,
      },
    })
  }

  async clearIssueCodingAgentSnapshot(issueId: number): Promise<void> {
    await this.prisma.client.issue_coding_agent_snapshot.deleteMany({
      where: {
        issue_id: issueId,
      },
    })
  }

  private async getPreferredCodingAgentForWorkspace(workspaceId: string): Promise<CodingAgentDetail> {
    const defaultCodingAgent = await this.codingAgentService.getDefaultCodingAgent(workspaceId)
    if (defaultCodingAgent) {
      return defaultCodingAgent
    }

    const firstCodingAgent = await this.codingAgentService.getFirstCodingAgent(workspaceId)
    if (firstCodingAgent) {
      return firstCodingAgent
    }

    throw new NotFoundException(`No coding agent is configured for workspace "${workspaceId}".`)
  }

  private toIssueCodingAgentSnapshot(snapshot: IssueCodingAgentSnapshotRecord): CodingAgentDetail {
    return {
      id: snapshot.id,
      name: snapshot.name,
      type: snapshot.type as CodingAgentDetail['type'],
      settings: snapshot.settings as CodingAgentDetail['settings'],
      isDefault: false,
      createdAt: snapshot.created_at.toISOString(),
      updatedAt: snapshot.updated_at.toISOString(),
    }
  }
}
