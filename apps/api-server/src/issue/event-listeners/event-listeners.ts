import { PrismaService } from '@/database/prisma.service'
import { ISSUE_EVENTS } from '@/event-bus/constants/event.constants'
import { OnTxEvent } from '@/event-bus/decorators/tx-event.decorator'
import { IssueCreatedEvent, IssueUpdatedEvent, TxEventWrapper } from '@/event-bus/types/event.types'
import { IssueService } from '@/issue/issue.service'
import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import {
  CALCULATED_PROPERTY_TYPES,
  NUMBER_VALUE_TYPES,
  PropertyType,
  SINGLE_VALUE_PROPERTY_TYPES,
  SystemPropertyId,
} from '@repo/shared/property/constants'
import type { Prisma } from '@repo/database'

@Injectable()
export class IssueEventListeners {
  private readonly logger = new Logger(IssueEventListeners.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly issueService: IssueService,
  ) {}

  @OnEvent(ISSUE_EVENTS.ISSUE_CREATED)
  async subscribeOnIssueCreated(event: IssueCreatedEvent): Promise<void> {
    try {
      const issueIds = event.issues.map(issue => issue.issueId)
      const assigneeIdsByIssueId = await this.loadAssigneeIdsByIssueId(issueIds)

      const subscriptionData = event.issues.flatMap(issue => {
        const subscriptions = [
          {
            user_id: issue.userId,
            issue_id: issue.issueId,
          },
        ]
        const assigneeId = assigneeIdsByIssueId.get(issue.issueId)
        if (assigneeId) {
          subscriptions.push({
            user_id: assigneeId,
            issue_id: issue.issueId,
          })
        }

        return subscriptions
      })

      if (subscriptionData.length > 0) {
        await this.prisma.client.subscription.createMany({
          data: subscriptionData,
          skipDuplicates: true,
        })
      }
    } catch (error) {
      this.logger.error(`Failed to create issue subscriptions on issue creation: ${(error as Error).message}`)
    }
  }

  @OnTxEvent(ISSUE_EVENTS.ISSUE_UPDATED_IN_TX)
  async subscribeAssigneeOnIssueUpdated(event: TxEventWrapper<IssueUpdatedEvent>): Promise<void> {
    if (!event.updatedPropertyIds.includes(SystemPropertyId.ASSIGNEE)) {
      return
    }

    try {
      // TODO: Use IssueService for issue property reads once it supports transaction-scoped reads.
      // Direct database access is kept temporarily because this listener runs inside the current transaction.
      const assigneeId = await event.tx.property_single_value
        .findFirst({
          where: {
            issue_id: event.issueId,
            property_id: SystemPropertyId.ASSIGNEE,
            deleted_at: null,
          },
          select: {
            value: true,
          },
        })
        .then(result => (typeof result?.value === 'string' && result.value.length > 0 ? result.value : null))

      if (!assigneeId) {
        return
      }

      const existingSubscription = await event.tx.subscription.findFirst({
        where: {
          user_id: assigneeId,
          issue_id: event.issueId,
          comment_id: null,
        },
        select: {
          id: true,
        },
      })

      if (existingSubscription) {
        return
      }

      await event.tx.subscription.create({
        data: {
          user_id: assigneeId,
          issue_id: event.issueId,
          comment_id: null,
        },
      })
    } catch (error) {
      this.logger.error(`Failed to create assignee subscription on issue update: ${(error as Error).message}`)
    }
  }

  @OnTxEvent(ISSUE_EVENTS.ISSUE_CREATED_IN_TX)
  async syncPropValuesOnIssuesCreated(event: TxEventWrapper<IssueCreatedEvent>): Promise<void> {
    await syncPropertyValuesToIssue(
      event.tx,
      event.issues.map(issue => issue.issueId),
    )
  }

  /** sync property values to issue.property_values JSON field when issues are updated */
  @OnTxEvent(ISSUE_EVENTS.ISSUE_UPDATED_IN_TX)
  async syncPropertyValuesOnIssueUpdated(event: TxEventWrapper<IssueUpdatedEvent>): Promise<void> {
    await syncPropertyValuesToIssue(event.tx, [event.issueId])
  }

  private async loadAssigneeIdsByIssueId(issueIds: number[]): Promise<Map<number, string>> {
    if (issueIds.length === 0) {
      return new Map()
    }

    const valuesByIssueId = await this.issueService.getIssuePropertyValuesByIds(issueIds, [SystemPropertyId.ASSIGNEE])

    const assigneeIdsByIssueId = new Map<number, string>()
    for (const [issueId, valuesByPropertyId] of valuesByIssueId.entries()) {
      const assigneeId = valuesByPropertyId.get(SystemPropertyId.ASSIGNEE)
      if (typeof assigneeId === 'string' && assigneeId.trim().length > 0) {
        assigneeIdsByIssueId.set(issueId, assigneeId.trim())
      }
    }

    return assigneeIdsByIssueId
  }
}

/**
 * Sync property values from single/multi value tables to issue.property_values JSON field
 * This function can be reused for both issue creation and update scenarios
 */
const syncPropertyValuesToIssue = async (tx: Prisma.TransactionClient, issueIds: number[]) => {
  if (issueIds.length === 0) {
    return
  }

  // TODO: Use IssueService for issue property reads once it accepts transaction clients.
  // Direct database access is kept temporarily because this sync must read within the current transaction.
  // get all non-calculated property definitions
  const properties = await tx.property.findMany({
    where: {
      type: { notIn: CALCULATED_PROPERTY_TYPES },
      deleted_at: null,
    },
    select: { id: true, type: true },
  })

  // query property values in batch
  const [singleValues, multiValues] = await Promise.all([
    tx.property_single_value.findMany({
      where: {
        issue_id: { in: issueIds },
        deleted_at: null,
      },
      select: {
        issue_id: true,
        property_id: true,
        value: true,
        number_value: true,
      },
    }),
    tx.property_multi_value.findMany({
      where: {
        issue_id: { in: issueIds },
        deleted_at: null,
      },
      select: {
        issue_id: true,
        property_id: true,
        value: true,
        number_value: true,
        position: true,
      },
      orderBy: { position: 'asc' },
    }),
  ])

  // group values by issue for efficient processing
  const singleValuesByIssue = new Map<number, Map<string, { value: string | null; number_value: number | null }>>()
  const multiValuesByIssue = new Map<
    number,
    Map<string, Array<{ value: string | null; number_value: number | null; position: number }>>
  >()

  for (const sv of singleValues) {
    if (!singleValuesByIssue.has(sv.issue_id)) {
      singleValuesByIssue.set(sv.issue_id, new Map())
    }
    singleValuesByIssue.get(sv.issue_id)!.set(sv.property_id, {
      value: sv.value,
      number_value: sv.number_value,
    })
  }

  for (const mv of multiValues) {
    if (!multiValuesByIssue.has(mv.issue_id)) {
      multiValuesByIssue.set(mv.issue_id, new Map())
    }
    const issueMultiValues = multiValuesByIssue.get(mv.issue_id)!
    if (!issueMultiValues.has(mv.property_id)) {
      issueMultiValues.set(mv.property_id, [])
    }
    issueMultiValues.get(mv.property_id)!.push({
      value: mv.value,
      number_value: mv.number_value,
      position: mv.position,
    })
  }

  // build property_values JSON for each issue
  const issueUpdates: Array<{ id: number; property_values: object }> = []

  for (const issueId of issueIds) {
    const propertyValues: Record<string, unknown> = {}
    const issueSingleValues =
      singleValuesByIssue.get(issueId) || new Map<string, { value: string | null; number_value: number | null }>()
    const issueMultiValues =
      multiValuesByIssue.get(issueId) ||
      new Map<string, Array<{ value: string | null; number_value: number | null; position: number }>>()

    for (const property of properties) {
      const isSingleValue = SINGLE_VALUE_PROPERTY_TYPES.includes(property.type as PropertyType)
      const useNumberValue = NUMBER_VALUE_TYPES.includes(property.type as PropertyType)

      if (isSingleValue) {
        const singleValue = issueSingleValues.get(property.id)
        if (singleValue) {
          propertyValues[property.id] = useNumberValue ? singleValue.number_value : singleValue.value
        } else {
          propertyValues[property.id] = null
        }
      } else {
        const multiValueList = issueMultiValues.get(property.id) || []
        if (multiValueList.length > 0) {
          const sortedValues = multiValueList
            .sort((a: { position: number }, b: { position: number }) => a.position - b.position)
            .map((item: { value: string | null; number_value: number | null }) =>
              useNumberValue ? item.number_value : item.value,
            )
          propertyValues[property.id] = sortedValues
        } else {
          propertyValues[property.id] = null
        }
      }
    }

    issueUpdates.push({
      id: issueId,
      property_values: propertyValues,
    })
  }
  // batch update issues atomically
  if (issueUpdates.length > 0) {
    await Promise.all(
      issueUpdates.map(update =>
        tx.issue.update({
          where: { id: update.id },
          data: { property_values: update.property_values },
        }),
      ),
    )
  }
}
