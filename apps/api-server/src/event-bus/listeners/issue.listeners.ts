import { PrismaService } from '@/database/prisma.service'
import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import {
  CALCULATED_PROPERTY_TYPES,
  NUMBER_VALUE_TYPES,
  PropertyType,
  SINGLE_VALUE_PROPERTY_TYPES,
} from '@repo/shared/property/constants'
import { ISSUE_EVENTS } from '../constants/event.constants'
import { OnTxEvent } from '../decorators/tx-event.decorator'
import { IssueCreatedEvent, TxEventWrapper } from '../types/event.types'
import type { Prisma } from '@repo/database'

@Injectable()
export class IssueEventListeners {
  private readonly logger = new Logger(IssueEventListeners.name)

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(ISSUE_EVENTS.ISSUE_CREATED)
  async subscribeOnIssueCreated(event: IssueCreatedEvent): Promise<void> {
    try {
      const subscriptionData = event.issues.map(issue => ({
        user_id: issue.userId,
        issue_id: issue.issueId,
      }))

      if (subscriptionData.length > 0) {
        await this.prisma.client.subscription.createMany({
          data: subscriptionData,
          skipDuplicates: true,
        })
      }
    } catch (error) {
      this.logger.error(`Failed to create subscription: ${error}`)
    }
  }

  @OnTxEvent(ISSUE_EVENTS.ISSUE_CREATED_IN_TX)
  async syncPropValuesOnIssuesCreated(event: TxEventWrapper<IssueCreatedEvent>): Promise<void> {
    await this.syncPropertyValuesToIssue(
      event.tx,
      event.issues.map(issue => issue.issueId),
    )
  }

  async syncPropertyValuesToIssue(tx: Prisma.TransactionClient, issueIds: number[]): Promise<void> {
    if (issueIds.length === 0) {
      return
    }

    // TODO: Use IssueService for issue property reads once it accepts transaction clients.
    // Direct database access is kept temporarily because this sync must read within the current transaction.
    const properties = await tx.property.findMany({
      where: {
        type: { notIn: CALCULATED_PROPERTY_TYPES },
        deleted_at: null,
      },
      select: { id: true, type: true },
    })

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

    // group values by issue to improve performance
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
      const issueSingleValues = singleValuesByIssue.get(issueId) || new Map()
      const issueMultiValues = multiValuesByIssue.get(issueId) || new Map()

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
}
