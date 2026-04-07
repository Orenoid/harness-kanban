import { AuthService } from '@/auth/auth.service'
import { PrismaService } from '@/database/prisma.service'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@repo/database'
import {
  CodingAgentDetail,
  CodingAgentSettings,
  CodingAgentType,
  CreateCodingAgentInput,
  normalizeCodingAgentName,
  normalizeCodingAgentSettings,
  parseCodingAgentSettings,
  UpdateCodingAgentInput,
} from '@repo/shared'

type CodingAgentRecord = {
  id: string
  workspace_id: string
  name: string
  type: string
  settings: unknown
  is_default: boolean
  created_at: Date
  updated_at: Date
}

@Injectable()
export class CodingAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async createCodingAgent(
    userId: string,
    workspaceId: string,
    input: CreateCodingAgentInput,
  ): Promise<CodingAgentDetail> {
    const hasPermission = await this.auth.checkUserPermission(workspaceId, userId, this.auth.CREATE_ISSUE_PERMISSION)
    if (!hasPermission) {
      throw new ForbiddenException('No access to create coding agents')
    }

    const normalizedInput = this.normalizeCreateInput(input)
    const existingAgent = await this.prisma.client.coding_agent.findFirst({
      where: {
        workspace_id: workspaceId,
        name: normalizedInput.name,
      },
      select: {
        id: true,
      },
    })

    if (existingAgent) {
      throw new BadRequestException('A coding agent with this name already exists.')
    }

    const codingAgent = await this.prisma.client.$transaction(async tx => {
      if (normalizedInput.isDefault) {
        await tx.coding_agent.updateMany({
          where: {
            workspace_id: workspaceId,
            is_default: true,
          },
          data: {
            is_default: false,
          },
        })
      }

      return tx.coding_agent.create({
        data: {
          workspace_id: workspaceId,
          name: normalizedInput.name,
          type: normalizedInput.type,
          settings: this.serializeSettings(normalizedInput.settings),
          is_default: normalizedInput.isDefault,
        },
      })
    })

    return this.toCodingAgentDetail(codingAgent)
  }

  async getCodingAgents(userId: string, workspaceId: string): Promise<CodingAgentDetail[]> {
    const hasPermission = await this.auth.checkUserPermission(workspaceId, userId, this.auth.UPDATE_ISSUE_PERMISSION)
    if (!hasPermission) {
      throw new ForbiddenException('No access to view coding agents')
    }

    const codingAgents = await this.prisma.client.coding_agent.findMany({
      where: {
        workspace_id: workspaceId,
      },
      orderBy: [{ is_default: 'desc' }, { type: 'asc' }, { created_at: 'asc' }],
    })

    return codingAgents.map(codingAgent => this.toCodingAgentDetail(codingAgent))
  }

  async getCodingAgentById(userId: string, workspaceId: string, codingAgentId: string): Promise<CodingAgentDetail> {
    const hasPermission = await this.auth.checkUserPermission(workspaceId, userId, this.auth.UPDATE_ISSUE_PERMISSION)
    if (!hasPermission) {
      throw new ForbiddenException('No access to view coding agents')
    }

    const codingAgent = await this.findCodingAgentRecord(workspaceId, codingAgentId)
    if (!codingAgent) {
      throw new NotFoundException('Coding agent does not exist.')
    }

    return this.toCodingAgentDetail(codingAgent)
  }

  async updateCodingAgent(
    userId: string,
    workspaceId: string,
    codingAgentId: string,
    input: UpdateCodingAgentInput,
  ): Promise<CodingAgentDetail> {
    const hasPermission = await this.auth.checkUserPermission(workspaceId, userId, this.auth.UPDATE_ISSUE_PERMISSION)
    if (!hasPermission) {
      throw new ForbiddenException('No access to update coding agents')
    }

    const existingAgent = await this.findCodingAgentRecord(workspaceId, codingAgentId)
    if (!existingAgent) {
      throw new NotFoundException('Coding agent does not exist.')
    }

    const normalizedInput = this.normalizeUpdateInput(existingAgent, input)

    if (normalizedInput.name && normalizedInput.name !== existingAgent.name) {
      const duplicate = await this.prisma.client.coding_agent.findFirst({
        where: {
          workspace_id: workspaceId,
          name: normalizedInput.name,
          id: { not: codingAgentId },
        },
        select: {
          id: true,
        },
      })

      if (duplicate) {
        throw new BadRequestException('A coding agent with this name already exists.')
      }
    }

    const shouldBecomeDefault = normalizedInput.is_default === true

    const codingAgent = await this.prisma.client.$transaction(async tx => {
      if (shouldBecomeDefault) {
        await tx.coding_agent.updateMany({
          where: {
            workspace_id: workspaceId,
            is_default: true,
            id: { not: codingAgentId },
          },
          data: {
            is_default: false,
          },
        })
      }

      return tx.coding_agent.update({
        where: {
          id: codingAgentId,
        },
        data: normalizedInput,
      })
    })

    return this.toCodingAgentDetail(codingAgent)
  }

  async deleteCodingAgent(userId: string, workspaceId: string, codingAgentId: string): Promise<void> {
    const hasPermission = await this.auth.checkUserPermission(workspaceId, userId, this.auth.UPDATE_ISSUE_PERMISSION)
    if (!hasPermission) {
      throw new ForbiddenException('No access to delete coding agents')
    }

    const existingAgent = await this.findCodingAgentRecord(workspaceId, codingAgentId)
    if (!existingAgent) {
      throw new NotFoundException('Coding agent does not exist.')
    }

    await this.prisma.client.coding_agent.delete({
      where: {
        id: codingAgentId,
      },
    })
  }

  async hasCodingAgentConfigured(workspaceId: string): Promise<boolean> {
    const codingAgent = await this.prisma.client.coding_agent.findFirst({
      where: {
        workspace_id: workspaceId,
      },
      select: {
        id: true,
      },
      orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
    })

    return Boolean(codingAgent)
  }

  async getDefaultCodingAgent(workspaceId: string): Promise<CodingAgentDetail | null> {
    const codingAgent = await this.prisma.client.coding_agent.findFirst({
      where: {
        workspace_id: workspaceId,
        is_default: true,
      },
      orderBy: [{ created_at: 'asc' }],
    })

    return codingAgent ? this.toCodingAgentDetail(codingAgent) : null
  }

  async getFirstCodingAgent(workspaceId: string): Promise<CodingAgentDetail | null> {
    const codingAgent = await this.prisma.client.coding_agent.findFirst({
      where: {
        workspace_id: workspaceId,
      },
      orderBy: [{ created_at: 'asc' }],
    })

    return codingAgent ? this.toCodingAgentDetail(codingAgent) : null
  }

  private async findCodingAgentRecord(workspaceId: string, codingAgentId: string): Promise<CodingAgentRecord | null> {
    return this.prisma.client.coding_agent.findFirst({
      where: {
        id: codingAgentId,
        workspace_id: workspaceId,
      },
    })
  }

  private normalizeCreateInput(input: CreateCodingAgentInput): {
    name: string
    type: CodingAgentType
    settings: CodingAgentSettings
    isDefault: boolean
  } {
    return {
      name: this.normalizeName(input.name),
      type: input.type,
      settings: this.requireSettings(input.type, input.settings),
      isDefault: Boolean(input.isDefault),
    }
  }

  private normalizeUpdateInput(
    existingAgent: { type: string; settings: unknown },
    input: UpdateCodingAgentInput,
  ): {
    name?: string
    type?: CodingAgentType
    settings?: Prisma.InputJsonValue
    is_default?: boolean
  } {
    const data: {
      name?: string
      type?: CodingAgentType
      settings?: Prisma.InputJsonValue
      is_default?: boolean
    } = {}

    const nextType = (input.type ?? existingAgent.type) as CodingAgentType

    if ('name' in input && input.name !== undefined) {
      data.name = this.normalizeName(input.name)
    }

    if ('type' in input && input.type !== undefined) {
      data.type = input.type
    }

    if ('settings' in input || ('type' in input && input.type !== undefined)) {
      const rawSettings =
        input.settings ?? parseCodingAgentSettings(existingAgent.type as CodingAgentType, existingAgent.settings)
      data.settings = this.serializeSettings(this.requireSettings(nextType, rawSettings as CodingAgentSettings))
    }

    if ('isDefault' in input && input.isDefault !== undefined) {
      data.is_default = Boolean(input.isDefault)
    }

    return data
  }

  private normalizeName(raw: string): string {
    try {
      return normalizeCodingAgentName(raw)
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : String(error))
    }
  }

  private requireSettings<TType extends CodingAgentType>(
    type: TType,
    settings: CodingAgentSettings<TType> | null | undefined,
  ): CodingAgentSettings<TType> {
    if (!settings) {
      throw new BadRequestException(`Coding agent settings are required for type "${type}".`)
    }

    const parsedSettings = parseCodingAgentSettings(type, settings)
    if (!parsedSettings) {
      throw new BadRequestException(`Coding agent settings are invalid for type "${type}".`)
    }

    return normalizeCodingAgentSettings(type, parsedSettings) as CodingAgentSettings<TType>
  }

  private serializeSettings(settings: CodingAgentSettings): Prisma.InputJsonValue {
    return settings as unknown as Prisma.InputJsonValue
  }

  private toCodingAgentDetail(record: CodingAgentRecord): CodingAgentDetail {
    const detail = this.parseCodingAgentDetailRecord(record.type, record.settings)

    return {
      id: record.id,
      name: record.name,
      type: detail.type,
      settings: detail.settings,
      isDefault: record.is_default,
      createdAt: record.created_at.toISOString(),
      updatedAt: record.updated_at.toISOString(),
    }
  }

  private parseCodingAgentDetailRecord(
    typeValue: string,
    settingsValue: unknown,
  ): {
    type: CodingAgentType
    settings: CodingAgentSettings
  } {
    const type = typeValue as CodingAgentType
    const settings = parseCodingAgentSettings(type, settingsValue)
    if (!settings) {
      throw new BadRequestException(`Stored coding agent settings are invalid for type "${typeValue}".`)
    }

    return {
      type,
      settings,
    }
  }
}
