import { AuthService } from '@/auth/auth.service'
import { PrismaService } from '@/database/prisma.service'
import { ISSUE_EVENTS } from '@/event-bus/constants/event.constants'
import { emit, emitInTx } from '@/event-bus/event-bus'
import {
  ActivityCreatedEvent,
  IssueCreatedEvent,
  IssueDeletedEvent,
  IssuePropertyChange,
  IssueUpdatedEvent,
} from '@/event-bus/types/event.types'
import { PRE_CREATE_ISSUE_HOOKS, PRE_UPDATE_ISSUE_HOOKS } from '@/issue/constants/hook.constants'
import { PreCreateIssueHook, PreUpdateIssueHook } from '@/issue/types/hook.types'
import { REGISTRY_NAMES } from '@/property/constants/registry.constants'
import { PropertyImplRegistry } from '@/property/impl-registry.service'
import { PropertyService } from '@/property/property.service'
import {
  CreationPropertyProcessor,
  MultiValueUpdateData,
  PropertyValueResolver,
  UpdatePropertyProcessor,
} from '@/property/types/property.types'
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Prisma } from '@repo/database'
import { ActivityType } from '@repo/shared/issue/constants'
import {
  CALCULATED_PROPERTY_TYPES,
  CommonPropertyOperationType,
  FilterOperator,
  NUMBER_VALUE_TYPES,
  PROPERTY_ID_TYPE_MAP,
  PropertyType,
  SINGLE_VALUE_PROPERTY_TYPES,
  SystemPropertyId,
} from '@repo/shared/property/constants'
import { findStatusDefinition, resolveStatusActions } from '@repo/shared/property/status-config'
import {
  FilterCondition,
  Issue,
  Operation,
  PropertyDefinition,
  PropertyValue,
  ResolveStatusActionsInput,
  ResolveStatusActionsResult,
  SortParam,
} from '@repo/shared/property/types'
import { ConstructActivityParams } from './types/activity.types'
import { BaseContext, CreateIssueInput, UpdateIssueInput, UpdateIssueResult } from './types/issue.types'

export type CreateIssueResult = {
  issueId: number
  success: boolean
  errors?: string[]
}

export type IssueStateSnapshot = {
  assigneeId: string | null
  statusId: string | null
}

@Injectable()
export class IssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly propertyService: PropertyService,
    private readonly propertyImplRegistry: PropertyImplRegistry,
    private readonly eventEmitter: EventEmitter2,
    @Optional()
    @Inject(PRE_CREATE_ISSUE_HOOKS)
    private readonly preCreateIssueHooks: PreCreateIssueHook[] = [],
    @Optional()
    @Inject(PRE_UPDATE_ISSUE_HOOKS)
    private readonly preUpdateIssueHooks: PreUpdateIssueHook[] = [],
  ) {}

  async getIssues(
    filters: FilterCondition[] | undefined,
    sort: SortParam[],
    workspaceId?: string,
    filterRelation: 'and' | 'or' = 'and',
    page?: number,
    pageSize?: number,
  ): Promise<{ issues: Issue[]; total: number }> {
    // Validate property IDs in filters
    if (filters && filters.length > 0) {
      filters = await this.normalizeFilters(filters)
    }

    const { whereClause, values: whereValues } = this.buildParameterizedWhereClause(filters || [], filterRelation, 1)
    const { orderByClause, values: orderByValues } = this.buildParameterizedOrderByClause(sort, whereValues.length + 1)

    const allValues = [...whereValues, ...orderByValues]
    let nextParamIndex = allValues.length + 1

    let sqlString = `
      SELECT issue.id, COUNT(*) OVER () as total_count
      FROM issue
      WHERE issue.deleted_at IS NULL
    `
    if (workspaceId) {
      sqlString += ` AND issue.workspace_id = $${nextParamIndex}`
      allValues.push(workspaceId)
      nextParamIndex++
    }
    if (whereClause) {
      sqlString += ` AND (${whereClause})`
    }
    if (orderByClause) {
      sqlString += ` ORDER BY ${orderByClause} , issue.id ASC`
    } else {
      sqlString += ` ORDER BY issue.id ASC`
    }

    if (page !== undefined && pageSize !== undefined) {
      const skip = (page - 1) * pageSize
      sqlString += ` LIMIT $${nextParamIndex} OFFSET $${nextParamIndex + 1}`
      allValues.push(pageSize, skip)
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const query = Prisma.raw(sqlString) as any
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    query.values = allValues
    const issueResults = await this.prisma.client.$queryRaw<{ id: number; total_count: bigint }[]>(query)

    const issueIds = issueResults.map(r => r.id)
    const issues = await this.getIssuesWithValues(issueIds)

    const total = issueResults.length > 0 && issueResults[0] ? Number(issueResults[0].total_count) : 0
    return { issues, total }
  }

  async deleteIssue(workspaceId: string, userId: string, issueId: number) {
    const issue = await this.prisma.client.issue.findUnique({
      where: { id: issueId },
      select: { workspace_id: true },
    })
    if (!issue) {
      throw new NotFoundException('Issue does not exist.')
    }
    // check if the issue belongs to the workspace
    if (issue.workspace_id !== workspaceId) {
      throw new NotFoundException('Issue does not exist.')
    }

    const hasPermission = await this.auth.checkUserPermission(workspaceId, userId, this.auth.MANAGE_ISSUE_PERMISSION)
    if (!hasPermission) {
      throw new ForbiddenException('No access to delete issues')
    }

    let deletedEvent: IssueDeletedEvent | null = null

    await this.prisma.client.$transaction(async tx => {
      const [issueTitleRecord, subscriptions] = await Promise.all([
        tx.property_single_value.findFirst({
          where: {
            issue_id: issueId,
            property_id: SystemPropertyId.TITLE,
          },
          select: {
            value: true,
          },
        }),
        tx.subscription.findMany({
          where: {
            issue_id: issueId,
            comment_id: null,
          },
          select: {
            user_id: true,
          },
        }),
      ])

      deletedEvent = {
        workspaceId,
        userId,
        issueId,
        issueTitle: issueTitleRecord?.value || `Issue #${issueId}`,
        subscriberIds: subscriptions.map(subscription => subscription.user_id),
      }

      await Promise.all([
        tx.property_single_value.deleteMany({
          where: { issue_id: issueId },
        }),
        tx.property_multi_value.deleteMany({
          where: { issue_id: issueId },
        }),
        tx.issue.delete({
          where: { id: issueId },
        }),
      ])

      await emitInTx(this.eventEmitter, tx, ISSUE_EVENTS.ISSUE_DELETED_IN_TX, {
        ...deletedEvent,
      })
    })

    if (deletedEvent) {
      emit(this.eventEmitter, ISSUE_EVENTS.ISSUE_DELETED, deletedEvent)
    }
  }

  async getIssueById(id: number): Promise<Issue> {
    // First check if the issue exists and is not deleted
    const issueExists = await this.prisma.client.issue.findFirst({
      where: {
        id: id,
        deleted_at: null,
      },
    })

    if (!issueExists) {
      throw new NotFoundException(`Issue with ID ${id} not found`)
    }

    // Get issue with all property values
    const issues = await this.getIssuesWithValues([id])

    if (issues.length === 0) {
      throw new NotFoundException(`Issue with ID ${id} not found`)
    }

    return issues[0]
  }

  async getIssuesByIds(issueIds: number[], workspaceId?: string): Promise<Issue[]> {
    if (issueIds.length === 0) {
      return []
    }

    const issues = await this.prisma.client.issue.findMany({
      where: {
        id: { in: issueIds },
        deleted_at: null,
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      },
      select: {
        id: true,
      },
    })

    const existingIssueIds = new Set(issues.map(issue => issue.id))
    const orderedIssueIds = issueIds.filter(issueId => existingIssueIds.has(issueId))

    return this.getIssuesWithValues(orderedIssueIds)
  }

  async getIssuePropertyValue(issueId: number, propertyId: string): Promise<unknown> {
    const issue = await this.getIssueById(issueId)
    return issue.propertyValues.find(propertyValue => propertyValue.propertyId === propertyId)?.value
  }

  async getIssueStringPropertyValue(issueId: number, propertyId: string): Promise<string | null> {
    const value = await this.getIssuePropertyValue(issueId, propertyId)
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  async getIssuePropertyValuesByIds(
    issueIds: number[],
    propertyIds: string[],
    workspaceId?: string,
  ): Promise<Map<number, Map<string, unknown>>> {
    const valuesByIssueId = new Map<number, Map<string, unknown>>()
    if (issueIds.length === 0) {
      return valuesByIssueId
    }

    const requestedPropertyIds = new Set(propertyIds)
    const issues = await this.getIssuesByIds(issueIds, workspaceId)

    for (const issue of issues) {
      const valuesByPropertyId = new Map<string, unknown>()

      for (const propertyValue of issue.propertyValues) {
        if (requestedPropertyIds.has(propertyValue.propertyId)) {
          valuesByPropertyId.set(propertyValue.propertyId, propertyValue.value)
        }
      }

      valuesByIssueId.set(issue.issueId, valuesByPropertyId)
    }

    return valuesByIssueId
  }

  // TODO should just use getIssuesByIds
  async getIssueStates(issueIds: number[], workspaceId?: string): Promise<Map<number, IssueStateSnapshot>> {
    if (issueIds.length === 0) {
      return new Map()
    }

    const issues = await this.prisma.client.issue.findMany({
      where: {
        id: { in: issueIds },
        deleted_at: null,
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      },
      select: {
        id: true,
      },
    })

    const existingIssueIds = new Set(issues.map(issue => issue.id))
    const orderedIssueIds = issueIds.filter(issueId => existingIssueIds.has(issueId))
    if (orderedIssueIds.length === 0) {
      return new Map()
    }

    const issueStates = new Map<number, IssueStateSnapshot>(
      orderedIssueIds.map(issueId => [
        issueId,
        {
          assigneeId: null,
          statusId: null,
        },
      ]),
    )

    const rows = await this.prisma.client.property_single_value.findMany({
      where: {
        issue_id: { in: orderedIssueIds },
        property_id: { in: [SystemPropertyId.ASSIGNEE, SystemPropertyId.STATUS] },
        deleted_at: null,
      },
      select: {
        issue_id: true,
        property_id: true,
        value: true,
      },
    })

    for (const row of rows) {
      const issueState = issueStates.get(row.issue_id)
      if (!issueState || typeof row.value !== 'string' || row.value.length === 0) {
        continue
      }

      if (row.property_id === SystemPropertyId.ASSIGNEE) {
        issueState.assigneeId = row.value
      }

      if (row.property_id === SystemPropertyId.STATUS) {
        issueState.statusId = row.value
      }
    }

    return issueStates
  }

  async batchCreateIssues(workspaceId: string, creatorId: string, issues: CreateIssueInput[]) {
    if (issues.length === 0) {
      return []
    }

    const hasPermission = await this.auth.checkUserPermission(workspaceId, creatorId, this.auth.CREATE_ISSUE_PERMISSION)
    if (!hasPermission) {
      throw new ForbiddenException('No access to create issues')
    }

    // get all property definitions
    const propertiesRecords = await this.prisma.client.property.findMany({
      where: {
        deleted_at: null,
      },
    })
    const properties: PropertyDefinition[] = propertiesRecords.map(record => ({
      id: record.id,
      name: record.name,
      description: record.description,
      type: record.type,
      config:
        record.config && typeof record.config === 'object' && !Array.isArray(record.config)
          ? (record.config as Record<string, unknown>)
          : undefined,
      readonly: record.readonly,
      deletable: record.deletable,
    })) as PropertyDefinition[]

    // TODO we need a default property value mechanism to decouple this status-specific logic
    const defaultStatusId = this.propertyService.getInitialStatusId(properties)

    issues.forEach(issue => {
      if (!issue.propertyValues.find(pv => pv.propertyId === SystemPropertyId.STATUS.toString())) {
        issue.propertyValues.push({
          propertyId: SystemPropertyId.STATUS.toString(),
          value: defaultStatusId,
        })
      }
    })

    // preprocess and validate all inputs
    const preprocessResults = await Promise.all(
      issues.map(issue =>
        this.preprocessIssueInput({ userId: creatorId, workspaceId: workspaceId }, issue, properties),
      ),
    )

    // check if there are any validation errors
    const hasErrors = preprocessResults.some(result => !result.success)

    // if there are any validation errors, return the results directly
    if (hasErrors) {
      return preprocessResults.map(result => ({
        issueId: 0,
        success: result.success,
        errors: result.errors,
      }))
    }

    try {
      const results = await this.prisma.client.$transaction(async tx => {
        const batchResults: CreateIssueResult[] = []

        // create all issues - add workspace_id
        const issueCreatePromises = issues.map(() =>
          tx.issue.create({
            data: {
              workspace_id: workspaceId ?? null,
              created_by: creatorId,
            },
          }),
        )
        const createdIssues = await Promise.all(issueCreatePromises)

        const allSingleValues: Prisma.property_single_valueCreateManyInput[] = []
        const allMultiValues: Prisma.property_multi_valueCreateManyInput[] = []
        const allActivities: Prisma.activityCreateManyInput[] = []

        for (let i = 0; i < issues.length; i++) {
          const input = issues[i]
          const createdIssue = createdIssues[i]
          if (!createdIssue || !input) continue
          const issueId = createdIssue.id
          const createdTime = createdIssue.created_at

          // add system assigned issue ID
          allSingleValues.push({
            issue_id: issueId,
            property_id: SystemPropertyId.ID,
            property_type: PropertyType.ID,
            number_value: issueId,
          })

          // add created time (redundant storage to property_single_value table)
          allSingleValues.push({
            issue_id: issueId,
            property_id: SystemPropertyId.CREATED_AT,
            property_type: PropertyType.DATETIME,
            value: createdTime.toISOString(),
            number_value: createdTime.getTime(),
          })

          for (const pv of input.propertyValues) {
            const property = properties.find(p => p.id === pv.propertyId)!

            // get processor and convert to database format
            const processor = this.getCreationPropertyProcessor(property.type)
            const dbData = await processor.transformToDbFormat(
              { userId: creatorId, workspaceId: workspaceId },
              property,
              pv.value,
              issueId,
            )

            if (dbData.singleValues && dbData.singleValues.length > 0) {
              allSingleValues.push(...dbData.singleValues)
            }
            if (dbData.multiValues && dbData.multiValues.length > 0) {
              allMultiValues.push(...dbData.multiValues)
            }
          }

          // add activity for issue creation
          allActivities.push({
            issue_id: issueId,
            type: ActivityType.CREATE_ISSUE.toString(),
            payload: { userId: creatorId },
            created_by: creatorId,
          })

          batchResults.push({
            issueId: issueId,
            success: true,
          })
        }

        // bulk create all property values
        if (allSingleValues.length > 0) {
          await tx.property_single_value.createMany({
            data: allSingleValues,
          })
        }
        if (allMultiValues.length > 0) {
          await tx.property_multi_value.createMany({
            data: allMultiValues,
          })
        }

        // bulk create all activities
        if (allActivities.length > 0) {
          await tx.activity.createMany({
            data: allActivities,
          })
        }

        const issueIds = batchResults.filter(result => result.success).map(result => result.issueId)
        if (issueIds.length > 0) {
          await emitInTx(this.eventEmitter, tx, ISSUE_EVENTS.ISSUE_CREATED_IN_TX, {
            issues: issueIds.map(id => ({
              workspaceId: workspaceId,
              userId: creatorId,
              issueId: id,
            })),
          } as IssueCreatedEvent)
        }

        return batchResults
      })

      const successfulIssues = results
        .filter(result => result.success)
        .map(result => ({
          workspaceId: workspaceId,
          userId: creatorId,
          issueId: result.issueId,
        }))

      if (successfulIssues.length > 0) {
        emit(this.eventEmitter, ISSUE_EVENTS.ISSUE_CREATED, {
          issues: successfulIssues,
        } as IssueCreatedEvent)
      }

      return results
    } catch (error) {
      console.error('createIssue batch create issues transaction failed:', error)
      return issues.map(() => ({
        issueId: 0,
        success: false,
        errors: [(error as Error).message],
      })) as CreateIssueResult[]
    }
  }

  async updateIssue(context: BaseContext, input: UpdateIssueInput): Promise<UpdateIssueResult> {
    const { workspaceId, userId } = context

    // Check if the issue exists
    const issue = await this.prisma.client.issue.findUnique({
      where: {
        id: input.issueId,
        deleted_at: null,
      },
    })
    if (!issue) {
      return {
        success: false,
        errors: [`Issue not found: ${input.issueId}`],
      } as UpdateIssueResult
    }

    if (issue.workspace_id !== workspaceId) {
      return {
        success: false,
        errors: [`Issue not found: ${input.issueId}`],
      } as UpdateIssueResult
    }

    // Get properties and validate they exist and are writable
    const propertyIds = [
      ...new Set([...input.operations.map(op => op.propertyId), SystemPropertyId.STATUS, SystemPropertyId.ASSIGNEE]),
    ]
    const properties = await this.prisma.client.property.findMany({
      where: {
        id: { in: propertyIds },
        deleted_at: null,
      },
    })

    const propertyMap = properties.map(prop => ({
      id: prop.id,
      name: prop.name,
      description: prop.description,
      type: prop.type,
      readonly: prop.readonly,
      config: prop.config as Record<string, unknown>,
      deletable: prop.deletable,
    })) as PropertyDefinition[]

    // Check if all properties exist and are writable
    for (const operation of input.operations) {
      const property = propertyMap.find(prop => prop.id === operation.propertyId)
      if (!property) {
        return {
          success: false,
          errors: [`Property not found: ${operation.propertyId}`],
        } as UpdateIssueResult
      }
      if (property.readonly) {
        return {
          success: false,
          errors: [`Property is read-only: ${property.name}`],
        } as UpdateIssueResult
      }
    }

    // compare with original values and ignore unchanged operations
    const originalPropertyValues = await this.getOriginalPropertyValues(input.issueId, propertyMap)
    const changedOperations: Operation[] = []

    for (const operation of input.operations) {
      const property = propertyMap.find(prop => prop.id === operation.propertyId)!
      try {
        const processor = this.propertyImplRegistry.getImpl<UpdatePropertyProcessor>(
          REGISTRY_NAMES.PROPERTY_UPDATE_PROCESSOR,
          property.type as PropertyType,
        )

        const formatValidation = processor.validateFormat(property, operation.operationType, operation.operationPayload)
        if (!formatValidation.valid) {
          return {
            success: false,
            errors: formatValidation.errors ?? ['Format validation failed'],
          } as UpdateIssueResult
        }

        const originalValue = originalPropertyValues.get(property.id) ?? null
        const hasChanged = processor.valueChanged(
          originalValue,
          property,
          operation.operationType,
          operation.operationPayload,
        )
        if (hasChanged) {
          changedOperations.push(operation)
        }
      } catch (error) {
        throw new Error(`Error processing property ${property.name}: ${(error as Error).message}`)
      }
    }

    if (changedOperations.length === 0) {
      return {
        success: true,
        issueId: input.issueId,
      }
    }

    for (const hook of this.preUpdateIssueHooks) {
      const hookResult = await hook.execute({
        workspaceId,
        userId,
        issueId: input.issueId,
        issue: {
          id: issue.id,
          workspace_id: issue.workspace_id,
        },
        operations: changedOperations,
        propertyMap,
        originalPropertyValues,
        getCurrentValue: propertyId => originalPropertyValues.get(propertyId) ?? null,
        getOperation: propertyId => this.getOperationForProperty(changedOperations, propertyId),
        getNextSetValue: propertyId =>
          this.getNextValueFromSetOperation(this.getOperationForProperty(changedOperations, propertyId)),
      })

      if (!hookResult.valid) {
        return {
          success: false,
          errors: hookResult.errors ?? ['Issue update validation failed'],
        }
      }
    }

    for (const operation of changedOperations) {
      const property = propertyMap.find(prop => prop.id === operation.propertyId)!
      try {
        const processor = this.propertyImplRegistry.getImpl<UpdatePropertyProcessor>(
          REGISTRY_NAMES.PROPERTY_UPDATE_PROCESSOR,
          property.type as PropertyType,
        )

        const businessValidation = await processor.validateBusinessRules(
          context,
          property,
          operation.operationType,
          operation.operationPayload,
          input.issueId,
        )
        if (!businessValidation.valid) {
          return {
            success: false,
            errors: businessValidation.errors ?? ['Business rules validation failed'],
          } as UpdateIssueResult
        }
      } catch (error) {
        throw new Error(`Error processing property ${property.name}: ${(error as Error).message}`)
      }
    }

    const activityEvents: ActivityCreatedEvent['activities'] = []
    const updatedPropertyIds = [...new Set(changedOperations.map(operation => operation.propertyId))]
    const propertyChanges = this.buildIssuePropertyChanges(changedOperations, originalPropertyValues)
    await this.prisma.client.$transaction(async tx => {
      const allActivities: ConstructActivityParams[] = []

      for (const operation of changedOperations) {
        const property = propertyMap.find(prop => prop.id === operation.propertyId)!
        try {
          const processor = this.propertyImplRegistry.getImpl<UpdatePropertyProcessor>(
            REGISTRY_NAMES.PROPERTY_UPDATE_PROCESSOR,
            property.type as PropertyType,
          )

          // Collect activities for later bulk insert
          const activities = processor.generateActivity(
            context,
            property,
            operation.operationType,
            operation.operationPayload,
            input.issueId,
          )
          allActivities.push(...activities)

          // Convert to database operations
          const operationResult = await processor.transformToDbOperations(
            context,
            property,
            operation.operationType,
            operation.operationPayload,
            input.issueId,
          )

          // execute single value property operations
          if (operationResult.singleValueClear) {
            // hard delete single value property
            await tx.property_single_value.deleteMany({
              where: {
                issue_id: input.issueId,
                property_id: property.id,
              },
            })
          } else if (operationResult.singleValueUpdate) {
            // update single value property
            await tx.property_single_value.upsert({
              where: {
                issue_id_property_id: {
                  issue_id: input.issueId,
                  property_id: property.id,
                },
              },
              update: {
                value: operationResult.singleValueUpdate.value,
                number_value: operationResult.singleValueUpdate.number_value,
              },
              create: {
                issue_id: input.issueId,
                property_id: property.id,
                property_type: property.type,
                value: operationResult.singleValueUpdate.value,
                number_value: operationResult.singleValueUpdate.number_value,
              },
            })
          }

          // execute multi value property operations
          // NOTE: the order of operations is important, because the multi value property is a set, so we need to clear first, then add
          if (operationResult.multiValueClear) {
            // hard delete all multi value property
            await tx.property_multi_value.deleteMany({
              where: {
                issue_id: input.issueId,
                property_id: property.id,
              },
            })
            if (operationResult.multiValueRemovePositions && operationResult.multiValueRemovePositions.length > 0) {
              // hard delete specified position multi value property
              await tx.property_multi_value.deleteMany({
                where: {
                  issue_id: input.issueId,
                  property_id: property.id,
                  position: { in: operationResult.multiValueRemovePositions },
                },
              })
            }
            if (operationResult.multiValueUpdates && operationResult.multiValueUpdates.size > 0) {
              // update multi value property
              for (const [position, updateData] of operationResult.multiValueUpdates.entries()) {
                await tx.property_multi_value.updateMany({
                  where: {
                    issue_id: input.issueId,
                    property_id: property.id,
                    position: position,
                  },
                  data: {
                    value: updateData.value,
                    number_value: updateData.number_value,
                  },
                })
              }
            }
            if (operationResult.multiValueCreates && operationResult.multiValueCreates.length > 0) {
              // create multi value property
              const multiValueCreateData = operationResult.multiValueCreates.map((item: MultiValueUpdateData) => ({
                issue_id: input.issueId,
                property_id: property.id,
                property_type: property.type,
                value: item.value,
                number_value: item.number_value,
                extra: item.extra,
                position: item.position,
              }))

              await tx.property_multi_value.createMany({
                data: multiValueCreateData,
                skipDuplicates: true, // if position exists, skip
              })
            }
          }
        } catch (error) {
          throw new Error(`Error processing property ${property.name}: ${(error as Error).message}`)
        }
      }

      // Bulk insert activities and collect the events
      if (allActivities.length > 0) {
        const activityCreateData = allActivities.map(activity => ({
          issue_id: activity.issueId,
          type: activity.type,
          payload: activity.payload as object,
          created_by: activity.createdBy,
        }))
        const createdActivities = await tx.activity.createManyAndReturn({
          data: activityCreateData,
        })
        activityEvents.push(
          ...createdActivities.map(activity => ({
            userId: userId,
            issueId: input.issueId,
            activityId: activity.id,
            workspaceId: workspaceId,
          })),
        )
      }

      // Update issue's updated_at time
      const now = new Date()
      await tx.issue.update({
        where: {
          id: input.issueId,
        },
        data: {
          updated_at: now,
        },
      })

      // Update property_single_value table's UPDATED_AT property value
      await tx.property_single_value.upsert({
        where: {
          issue_id_property_id: {
            issue_id: input.issueId,
            property_id: SystemPropertyId.UPDATED_AT,
          },
        },
        update: {
          value: now.toISOString(),
          number_value: now.getTime(),
        },
        create: {
          issue_id: input.issueId,
          property_id: SystemPropertyId.UPDATED_AT,
          property_type: PropertyType.DATETIME,
          value: now.toISOString(),
          number_value: now.getTime(),
        },
      })

      await emitInTx(this.eventEmitter, tx, ISSUE_EVENTS.ACTIVITY_CREATED_IN_TX, {
        activities: activityEvents.map(event => ({
          workspaceId: event.workspaceId,
          userId: event.userId,
          issueId: event.issueId,
          activityId: event.activityId,
        })),
      } as ActivityCreatedEvent)

      await emitInTx(this.eventEmitter, tx, ISSUE_EVENTS.ISSUE_UPDATED_IN_TX, {
        workspaceId: workspaceId,
        userId: userId,
        issueId: input.issueId,
        updatedPropertyIds,
        propertyChanges,
      } as IssueUpdatedEvent)
    })

    // Emit events outside transaction
    if (activityEvents.length > 0) {
      emit(this.eventEmitter, ISSUE_EVENTS.ACTIVITY_CREATED, {
        activities: activityEvents.map(event => ({
          workspaceId: event.workspaceId,
          userId: event.userId,
          issueId: event.issueId,
          activityId: event.activityId,
        })),
      } as ActivityCreatedEvent)
    }

    emit(this.eventEmitter, ISSUE_EVENTS.ISSUE_UPDATED, {
      workspaceId: workspaceId,
      userId: userId,
      issueId: input.issueId,
      updatedPropertyIds,
      propertyChanges,
    } as IssueUpdatedEvent)

    return {
      success: true,
      issueId: input.issueId,
    }
  }

  private buildIssuePropertyChanges(
    operations: Operation[],
    originalPropertyValues: Map<string, null | string | number | Array<string> | Array<number>>,
  ): IssuePropertyChange[] {
    return operations.map(operation => ({
      propertyId: operation.propertyId,
      previousValue: this.cloneEventValue(originalPropertyValues.get(operation.propertyId) ?? null),
      newValue: this.getNextEventValue(operation),
    }))
  }

  private getNextEventValue(operation: Operation): unknown {
    if (operation.operationType === CommonPropertyOperationType.CLEAR.toString()) {
      return null
    }

    if (operation.operationType === CommonPropertyOperationType.SET.toString()) {
      return this.cloneEventValue(operation.operationPayload.value ?? null)
    }

    return null
  }

  private cloneEventValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return [...value]
    }

    return value
  }

  private async preprocessIssueInput(
    context: BaseContext,
    input: CreateIssueInput,
    properties: PropertyDefinition[],
  ): Promise<{ success: boolean; errors?: string[] }> {
    // convert property values array to map for later processing
    const readonlyPropertyIds = properties.filter(prop => prop.readonly).map(prop => prop.id)

    const containsReadonlyProperty = input.propertyValues.some(pv => readonlyPropertyIds.includes(pv.propertyId))

    if (containsReadonlyProperty) {
      return {
        success: false,
        errors: ['Cannot modify read-only property'],
      }
    }

    // validate all property values
    const validationErrors: string[] = []
    for (const pv of input.propertyValues) {
      const property = properties.find(p => p.id === pv.propertyId)
      if (!property) {
        validationErrors.push(`Property ${pv.propertyId} does not exist`)
        continue
      }
      try {
        const processor = this.getCreationPropertyProcessor(property.type)
        // validate format
        const formatResult = processor.validateFormat(property, pv.value)
        if (!formatResult.valid) {
          validationErrors.push(...(formatResult.errors || []))
          continue
        }
      } catch (error) {
        validationErrors.push(`Property ${property.name} processor error: ${(error as Error).message}`)
        continue
      }
    }
    // if there are any validation errors, return the errors directly
    if (validationErrors.length > 0) {
      return {
        success: false,
        errors: validationErrors,
      }
    }

    for (const hook of this.preCreateIssueHooks) {
      const hookResult = await hook.execute({
        workspaceId: context.workspaceId,
        userId: context.userId,
        propertyMap: properties,
        propertyValues: input.propertyValues,
        getRequestedValue: propertyId => this.getRequestedCreateValue(input.propertyValues, propertyId),
      })

      if (!hookResult.valid) {
        return {
          success: false,
          errors: hookResult.errors ?? ['Issue creation validation failed'],
        }
      }
    }

    for (const pv of input.propertyValues) {
      const property = properties.find(p => p.id === pv.propertyId)
      if (!property) {
        continue
      }
      try {
        const processor = this.getCreationPropertyProcessor(property.type)
        const businessResult = await processor.validateBusinessRules(context, property, pv.value)
        if (!businessResult.valid) {
          validationErrors.push(...(businessResult.errors || ['Business rules validation failed']))
        }
      } catch (error) {
        validationErrors.push(`Property ${property.name} processor error: ${(error as Error).message}`)
      }
    }

    if (validationErrors.length > 0) {
      return {
        success: false,
        errors: validationErrors,
      }
    }

    return { success: true }
  }

  private getRequestedCreateValue(propertyValues: CreateIssueInput['propertyValues'], propertyId: string): unknown {
    return propertyValues.find(propertyValue => propertyValue.propertyId === propertyId)?.value
  }

  private getOperationForProperty(operations: Operation[], propertyId: string): Operation | undefined {
    return operations.find(operation => operation.propertyId === propertyId)
  }

  private getNextValueFromSetOperation(operation: Operation | undefined): unknown {
    if (!operation || operation.operationType !== 'set') {
      return undefined
    }

    return operation.operationPayload.value
  }

  private getCreationPropertyProcessor(propertyType: string): CreationPropertyProcessor {
    const processor = this.propertyImplRegistry.getImpl<CreationPropertyProcessor>(
      REGISTRY_NAMES.CREATION_PROPERTY_PROCESSOR,
      propertyType as PropertyType,
    )
    if (!processor) {
      throw new BadRequestException(`No property processor found for type: ${propertyType}`)
    }
    return processor
  }

  private async getIssuesWithValues(issueIds: number[]): Promise<Issue[]> {
    // parallel query single value and multi value properties of issues
    const [singlePropertyValues, multiPropertyValues, properties] = await Promise.all([
      this.prisma.client.property_single_value.findMany({
        where: {
          issue_id: { in: issueIds },
          deleted_at: null,
        },
        select: {
          issue_id: true,
          property_id: true,
          property_type: true,
          value: true,
          number_value: true,
          extra: true,
        },
      }),
      this.prisma.client.property_multi_value.findMany({
        where: {
          issue_id: { in: issueIds },
          deleted_at: null,
        },
        select: {
          issue_id: true,
          property_id: true,
          property_type: true,
          value: true,
          number_value: true,
          position: true,
          extra: true,
        },
      }),
      this.propertyService.getPropertyDefinitions(),
    ])

    const calculatedProperties = properties.filter(property =>
      CALCULATED_PROPERTY_TYPES.includes(property.type as PropertyType),
    )

    // group data by issue id
    const singleValuesByIssueId = new Map<number, Array<(typeof singlePropertyValues)[0]>>()
    const multiValuesByIssueId = new Map<number, Array<(typeof multiPropertyValues)[0]>>()

    // handle single value property grouping
    for (const spv of singlePropertyValues) {
      if (!singleValuesByIssueId.has(spv.issue_id)) {
        singleValuesByIssueId.set(spv.issue_id, [])
      }
      singleValuesByIssueId.get(spv.issue_id)!.push(spv)
    }
    // handle multi value property grouping
    for (const mpv of multiPropertyValues) {
      if (!multiValuesByIssueId.has(mpv.issue_id)) {
        multiValuesByIssueId.set(mpv.issue_id, [])
      }
      multiValuesByIssueId.get(mpv.issue_id)!.push(mpv)
    }

    // build result set
    const issues: Issue[] = []

    for (const issueId of issueIds) {
      const issueRawSingleValues = singleValuesByIssueId.get(issueId) || []
      const issueRawMultiValues = multiValuesByIssueId.get(issueId) || []

      // handle multi value property, merge multiple values of the same property into an array
      const multiValueMap = new Map<string, (string | number)[]>()
      for (const mpv of issueRawMultiValues) {
        const isNumberValue = NUMBER_VALUE_TYPES.includes(mpv.property_type as PropertyType)
        if (!multiValueMap.has(mpv.property_id)) {
          multiValueMap.set(mpv.property_id, [])
        }
        const value = isNumberValue ? mpv.number_value : mpv.value
        if (value) {
          multiValueMap.get(mpv.property_id)?.push(value)
        }
      }
      // convert to frontend format, handle single value property first
      const values: PropertyValue[] = issueRawSingleValues.map(pv => {
        const isNumberValue = NUMBER_VALUE_TYPES.includes(pv.property_type as PropertyType)
        const value = isNumberValue ? pv.number_value : pv.value
        return {
          propertyId: pv.property_id,
          value: value,
        }
      })

      // add multi value property
      for (const [propertyId, valueArray] of multiValueMap.entries()) {
        values.push({
          propertyId: propertyId,
          value: valueArray,
        })
      }

      // resolve calculated properties values
      for (const calculatedProperty of calculatedProperties) {
        const valueResolver = this.propertyImplRegistry.getImpl<PropertyValueResolver>(
          REGISTRY_NAMES.PROPERTY_VALUE_RESOLVER,
          calculatedProperty.type as PropertyType,
        )
        const value = await valueResolver?.resolve(
          issueId,
          calculatedProperty.id,
          null,
          issueRawMultiValues,
          issueRawSingleValues,
        )
        values.push({
          propertyId: calculatedProperty.id,
          value: value,
        })
      }
      // add to issue data
      issues.push({
        issueId: issueId,
        propertyValues: values,
      })
    }
    return issues
  }

  private async getOriginalPropertyValues(
    issueId: number,
    propertyMap: Array<PropertyDefinition>,
  ): Promise<Map<string, null | string | number | Array<string> | Array<number>>> {
    const propertyValueMap = new Map<string, null | string | number | Array<string> | Array<number>>()
    const propertyIds = propertyMap.map(p => p.id)

    const [singleValues, multiValues] = await Promise.all([
      this.prisma.client.property_single_value.findMany({
        where: {
          issue_id: issueId,
          property_id: { in: propertyIds },
          deleted_at: null,
        },
      }),
      this.prisma.client.property_multi_value.findMany({
        where: {
          issue_id: issueId,
          property_id: { in: propertyIds },
          deleted_at: null,
        },
      }),
    ])

    const singleValueMap = new Map<string, string | number | null>()
    for (const singleValue of singleValues) {
      const isNumberType = NUMBER_VALUE_TYPES.includes(singleValue.property_type as PropertyType)
      const value = isNumberType ? singleValue.number_value : singleValue.value
      singleValueMap.set(singleValue.property_id, value)
    }

    const multiValueGroups = new Map<string, Array<(typeof multiValues)[0]>>()
    for (const multiValue of multiValues) {
      if (!multiValueGroups.has(multiValue.property_id)) {
        multiValueGroups.set(multiValue.property_id, [])
      }
      multiValueGroups.get(multiValue.property_id)!.push(multiValue)
    }

    for (const property of propertyMap) {
      if (singleValueMap.has(property.id)) {
        propertyValueMap.set(property.id, singleValueMap.get(property.id)!)
      } else if (multiValueGroups.has(property.id)) {
        const values = multiValueGroups.get(property.id)!
        const firstValue = values[0]
        if (!firstValue) continue
        const isNumberType = NUMBER_VALUE_TYPES.includes(firstValue.property_type as PropertyType)
        if (isNumberType) {
          const arrayValue = values.map(v => v.number_value).filter((v): v is number => v !== null)
          propertyValueMap.set(property.id, arrayValue)
        } else {
          const arrayValue = values.map(v => v.value).filter((v): v is string => v !== null)
          propertyValueMap.set(property.id, arrayValue)
        }
      } else {
        propertyValueMap.set(property.id, null)
      }
    }

    return propertyValueMap
  }

  private async validateFilterPropertyIds(filters: FilterCondition[]): Promise<void> {
    await this.normalizeFilters(filters)
  }

  async resolveStatusActions(
    workspaceId: string,
    input: ResolveStatusActionsInput,
  ): Promise<ResolveStatusActionsResult> {
    const config = await this.propertyService.getStatusPropertyConfig()

    let currentStatusId = input.currentStatusId ?? config.initialStatusId

    if (input.issueId !== undefined) {
      const issue = await this.prisma.client.issue.findFirst({
        where: {
          id: input.issueId,
          workspace_id: workspaceId,
          deleted_at: null,
        },
        select: {
          id: true,
        },
      })

      if (!issue) {
        throw new NotFoundException(`Issue with ID ${input.issueId} not found`)
      }

      const currentStatusRecord = await this.prisma.client.property_single_value.findFirst({
        where: {
          issue_id: input.issueId,
          property_id: SystemPropertyId.STATUS,
          deleted_at: null,
        },
        select: {
          value: true,
        },
      })

      currentStatusId = currentStatusRecord?.value ?? config.initialStatusId
    }

    if (!findStatusDefinition(config, currentStatusId)) {
      throw new BadRequestException(`Unknown status: ${currentStatusId}`)
    }

    return {
      currentStatusId,
      actions: resolveStatusActions(config, currentStatusId),
    }
  }

  private buildParameterizedWhereClause(
    filters: FilterCondition[],
    filterRelation: 'and' | 'or',
    startParamIndex: number,
  ): { whereClause: string; values: unknown[] } {
    if (filters.length === 0) {
      return {
        whereClause: '',
        values: [],
      }
    }

    const sqlConditions: string[] = []
    const values: unknown[] = []
    let paramIndex = startParamIndex

    for (const filter of filters) {
      const { propertyId, operator, operand, propertyType } = filter
      const isSingleValue = SINGLE_VALUE_PROPERTY_TYPES.includes(propertyType as PropertyType)
      const isNumberValue = NUMBER_VALUE_TYPES.includes(propertyType as PropertyType)
      let conditionSQL = ''
      let conditionValues: unknown[] = []

      const safeNumericExpr = (key: string) => `NULLIF((property_values ->> ${key}), '')::numeric`

      switch (operator) {
        case FilterOperator.Equals:
          if (isNumberValue) {
            conditionSQL = `${safeNumericExpr(`$${paramIndex}`)} = $${paramIndex + 1}::numeric`
          } else {
            conditionSQL = `property_values ->> $${paramIndex} = $${paramIndex + 1}`
          }
          conditionValues = [propertyId, operand]
          break

        case FilterOperator.NotEquals:
          if (isNumberValue) {
            conditionSQL = `${safeNumericExpr(`$${paramIndex}`)} != $${paramIndex + 1}::numeric`
          } else {
            conditionSQL = `property_values ->> $${paramIndex} != $${paramIndex + 1}`
          }
          conditionValues = [propertyId, operand]
          break

        case FilterOperator.Set:
          conditionSQL = `property_values ? $${paramIndex} AND property_values ->> $${paramIndex} IS NOT NULL`
          conditionValues = [propertyId]
          break

        case FilterOperator.NotSet:
          conditionSQL = `NOT (property_values ? $${paramIndex}) OR property_values ->> $${paramIndex} IS NULL`
          conditionValues = [propertyId]
          break

        case FilterOperator.HasAnyOf: {
          const operandArray = Array.isArray(operand) ? operand : [operand]
          const orConditions: string[] = []
          for (let i = 0; i < operandArray.length; i++) {
            if (isSingleValue) {
              if (isNumberValue) {
                orConditions.push(`${safeNumericExpr(`$${paramIndex}`)} = $${paramIndex + 1 + i}::numeric`)
              } else {
                orConditions.push(`property_values ->> $${paramIndex} = $${paramIndex + 1 + i}`)
              }
            } else {
              orConditions.push(`property_values -> $${paramIndex} @> $${paramIndex + 1 + i}::jsonb`)
            }
          }
          conditionSQL = `(${orConditions.join(' OR ')})`
          conditionValues = [propertyId, ...operandArray.map(v => (isSingleValue ? v : JSON.stringify([v])))]
          break
        }

        case FilterOperator.HasNoneOf: {
          const operandArray = Array.isArray(operand) ? operand : [operand]
          const andConditions: string[] = []
          for (let i = 0; i < operandArray.length; i++) {
            if (isSingleValue) {
              if (isNumberValue) {
                andConditions.push(`${safeNumericExpr(`$${paramIndex}`)} != $${paramIndex + 1 + i}::numeric`)
              } else {
                andConditions.push(`property_values ->> $${paramIndex} != $${paramIndex + 1 + i}`)
              }
            } else {
              andConditions.push(`NOT (property_values -> $${paramIndex} @> $${paramIndex + 1 + i}::jsonb)`)
            }
          }
          conditionSQL = `(${andConditions.join(' AND ')})`
          conditionValues = [propertyId, ...operandArray.map(v => (isSingleValue ? v : JSON.stringify([v])))]
          break
        }

        case FilterOperator.Contains:
          conditionSQL = `property_values ->> $${paramIndex} ILIKE '%' || $${paramIndex + 1} || '%'`
          conditionValues = [propertyId, operand]
          break

        case FilterOperator.NotContains:
          conditionSQL = `NOT (property_values ->> $${paramIndex} ILIKE '%' || $${paramIndex + 1} || '%')`
          conditionValues = [propertyId, operand]
          break

        case FilterOperator.StartsWith:
          conditionSQL = `property_values ->> $${paramIndex} ILIKE $${paramIndex + 1} || '%'`
          conditionValues = [propertyId, operand]
          break

        case FilterOperator.NotStartsWith:
          conditionSQL = `NOT (property_values ->> $${paramIndex} ILIKE $${paramIndex + 1} || '%')`
          conditionValues = [propertyId, operand]
          break

        case FilterOperator.EndsWith:
          conditionSQL = `property_values ->> $${paramIndex} ILIKE '%' || $${paramIndex + 1}`
          conditionValues = [propertyId, operand]
          break

        case FilterOperator.NotEndsWith:
          conditionSQL = `NOT (property_values ->> $${paramIndex} ILIKE '%' || $${paramIndex + 1})`
          conditionValues = [propertyId, operand]
          break

        case FilterOperator.GreaterThan:
          conditionSQL = `${safeNumericExpr(`$${paramIndex}`)} > $${paramIndex + 1}::numeric`
          conditionValues = [propertyId, operand]
          break

        case FilterOperator.GreaterThanOrEqual:
          conditionSQL = `${safeNumericExpr(`$${paramIndex}`)} >= $${paramIndex + 1}::numeric`
          conditionValues = [propertyId, operand]
          break

        case FilterOperator.LessThan:
          conditionSQL = `${safeNumericExpr(`$${paramIndex}`)} < $${paramIndex + 1}::numeric`
          conditionValues = [propertyId, operand]
          break

        case FilterOperator.LessThanOrEqual:
          conditionSQL = `${safeNumericExpr(`$${paramIndex}`)} <= $${paramIndex + 1}::numeric`
          conditionValues = [propertyId, operand]
          break

        default:
          throw new BadRequestException(`Unsupported filter operator: ${operator as string}`)
      }

      sqlConditions.push(conditionSQL)
      values.push(...conditionValues)
      paramIndex += conditionValues.length
    }

    const relation = filterRelation.toUpperCase()
    const whereClause = sqlConditions.join(` ${relation} `)

    return { whereClause, values }
  }

  private buildParameterizedOrderByClause(sorts: SortParam[], startParamIndex: number) {
    if (sorts.length === 0) {
      return {
        orderByClause: '',
        values: [],
      }
    }

    const orderExpressions: string[] = []
    const values: unknown[] = []
    let paramIndex = startParamIndex

    for (const sort of sorts) {
      const { id: propertyId, desc } = sort
      const direction = desc ? 'DESC' : 'ASC'

      const propertyType = PROPERTY_ID_TYPE_MAP[propertyId as SystemPropertyId]
      const isNumericProperty = NUMBER_VALUE_TYPES.includes(propertyType as PropertyType)

      let orderExpression = ''
      if (propertyId === SystemPropertyId.PROJECT) {
        // TODO kinda bizarre to have this special case here
        orderExpression = `(SELECT project.name FROM project WHERE project.id = property_values ->> $${paramIndex} AND project.deleted_at IS NULL LIMIT 1) ${direction} NULLS LAST`
      } else if (isNumericProperty) {
        orderExpression = `NULLIF((property_values ->> $${paramIndex}), '')::numeric ${direction} NULLS LAST`
      } else {
        orderExpression = `property_values ->> $${paramIndex} ${direction} NULLS LAST`
      }

      orderExpressions.push(orderExpression)
      values.push(propertyId)
      paramIndex++
    }

    return {
      orderByClause: orderExpressions.join(', '),
      values,
    }
  }

  private async normalizeFilters(filters: FilterCondition[]): Promise<FilterCondition[]> {
    const properties = await this.propertyService.getPropertyDefinitions()
    const propertyTypeById = new Map(properties.map(property => [property.id, property.type]))

    return filters.map(filter => {
      const propertyType = propertyTypeById.get(filter.propertyId)
      if (!propertyType) {
        throw new BadRequestException(`Invalid property ID in filters: ${filter.propertyId}`)
      }

      return {
        ...filter,
        propertyType,
      }
    })
  }
}
