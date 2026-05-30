import { PrismaService } from '@/database/prisma.service'
import { IssueCreatedEvent, IssueUpdatedEvent, TxEventWrapper } from '@/event-bus/types/event.types'
import { IssueService } from '@/issue/issue.service'
import { SystemPropertyId } from '@repo/shared/property/constants'
import { IssueEventListeners } from '../event-listeners/event-listeners'

describe('IssueEventListeners', () => {
  let listeners: IssueEventListeners
  let prismaService: jest.Mocked<PrismaService>
  let issueService: jest.Mocked<IssueService>
  let tx: {
    property_single_value: {
      findFirst: jest.Mock
    }
    subscription: {
      findFirst: jest.Mock
      create: jest.Mock
    }
  }

  beforeEach(() => {
    prismaService = {
      client: {
        subscription: {
          createMany: jest.fn(),
        },
      },
    } as unknown as jest.Mocked<PrismaService>
    issueService = {
      getIssuePropertyValuesByIds: jest.fn(),
    } as unknown as jest.Mocked<IssueService>

    tx = {
      property_single_value: {
        findFirst: jest.fn(),
      },
      subscription: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    }

    listeners = new IssueEventListeners(prismaService, issueService)
    jest.clearAllMocks()
  })

  describe('subscribeOnIssueCreated', () => {
    it('should subscribe both creator and assignee when assignee exists', async () => {
      const event: IssueCreatedEvent = {
        issues: [
          {
            workspaceId: 'workspace-1',
            userId: 'creator-1',
            issueId: 101,
          },
        ],
      }

      issueService.getIssuePropertyValuesByIds.mockResolvedValue(
        new Map([[101, new Map([[SystemPropertyId.ASSIGNEE, 'assignee-1']])]]),
      )

      await listeners.subscribeOnIssueCreated(event)

      expect(issueService.getIssuePropertyValuesByIds).toHaveBeenCalledWith([101], [SystemPropertyId.ASSIGNEE])
      expect(prismaService.client.subscription.createMany).toHaveBeenCalledWith({
        data: [
          {
            user_id: 'creator-1',
            issue_id: 101,
          },
          {
            user_id: 'assignee-1',
            issue_id: 101,
          },
        ],
        skipDuplicates: true,
      })
    })

    it('should subscribe only the creator when issue has no assignee', async () => {
      const event: IssueCreatedEvent = {
        issues: [
          {
            workspaceId: 'workspace-1',
            userId: 'creator-1',
            issueId: 101,
          },
        ],
      }

      issueService.getIssuePropertyValuesByIds.mockResolvedValue(new Map())

      await listeners.subscribeOnIssueCreated(event)

      expect(prismaService.client.subscription.createMany).toHaveBeenCalledWith({
        data: [
          {
            user_id: 'creator-1',
            issue_id: 101,
          },
        ],
        skipDuplicates: true,
      })
    })

    it('should keep duplicate creator and assignee inserts idempotent with skipDuplicates', async () => {
      const event: IssueCreatedEvent = {
        issues: [
          {
            workspaceId: 'workspace-1',
            userId: 'same-user',
            issueId: 101,
          },
        ],
      }

      issueService.getIssuePropertyValuesByIds.mockResolvedValue(
        new Map([[101, new Map([[SystemPropertyId.ASSIGNEE, 'same-user']])]]),
      )

      await listeners.subscribeOnIssueCreated(event)

      expect(prismaService.client.subscription.createMany).toHaveBeenCalledWith({
        data: [
          {
            user_id: 'same-user',
            issue_id: 101,
          },
          {
            user_id: 'same-user',
            issue_id: 101,
          },
        ],
        skipDuplicates: true,
      })
    })
  })

  describe('subscribeAssigneeOnIssueUpdated', () => {
    it('should subscribe the current assignee when the assignee property changed', async () => {
      const event: TxEventWrapper<IssueUpdatedEvent> = {
        tx: tx as never,
        workspaceId: 'workspace-1',
        userId: 'actor-1',
        issueId: 101,
        updatedPropertyIds: [SystemPropertyId.ASSIGNEE],
        // FIXME: it's illegal (in terms of business logic) for this array to be empty when updatedPropertyIds contains ASSIGNEE
        propertyChanges: [],
      }

      tx.property_single_value.findFirst.mockResolvedValue({
        value: 'assignee-2',
      })
      tx.subscription.findFirst.mockResolvedValue(null)

      await listeners.subscribeAssigneeOnIssueUpdated(event)

      expect(tx.property_single_value.findFirst).toHaveBeenCalledWith({
        where: {
          issue_id: 101,
          property_id: SystemPropertyId.ASSIGNEE,
          deleted_at: null,
        },
        select: {
          value: true,
        },
      })
      expect(tx.subscription.findFirst).toHaveBeenCalledWith({
        where: {
          user_id: 'assignee-2',
          issue_id: 101,
          comment_id: null,
        },
        select: {
          id: true,
        },
      })
      expect(tx.subscription.create).toHaveBeenCalledWith({
        data: {
          user_id: 'assignee-2',
          issue_id: 101,
          comment_id: null,
        },
      })
    })

    it('should not create a duplicate issue subscription when the assignee is already subscribed', async () => {
      const event: TxEventWrapper<IssueUpdatedEvent> = {
        tx: tx as never,
        workspaceId: 'workspace-1',
        userId: 'actor-1',
        issueId: 101,
        updatedPropertyIds: [SystemPropertyId.ASSIGNEE],
        // FIXME: it's illegal (in terms of business logic) for this array to be empty when updatedPropertyIds contains ASSIGNEE
        propertyChanges: [],
      }

      tx.property_single_value.findFirst.mockResolvedValue({
        value: 'assignee-2',
      })
      tx.subscription.findFirst.mockResolvedValue({
        id: 'subscription-1',
      })

      await listeners.subscribeAssigneeOnIssueUpdated(event)

      expect(tx.subscription.create).not.toHaveBeenCalled()
    })

    it('should do nothing when assignee was cleared', async () => {
      const event: TxEventWrapper<IssueUpdatedEvent> = {
        tx: tx as never,
        workspaceId: 'workspace-1',
        userId: 'actor-1',
        issueId: 101,
        updatedPropertyIds: [SystemPropertyId.ASSIGNEE],
        // FIXME: it's illegal (in terms of business logic) for this array to be empty when updatedPropertyIds contains ASSIGNEE
        propertyChanges: [],
      }

      tx.property_single_value.findFirst.mockResolvedValue(null)

      await listeners.subscribeAssigneeOnIssueUpdated(event)

      expect(tx.subscription.findFirst).not.toHaveBeenCalled()
      expect(tx.subscription.create).not.toHaveBeenCalled()
    })

    it('should ignore updates that do not touch the assignee property', async () => {
      const event: TxEventWrapper<IssueUpdatedEvent> = {
        tx: tx as never,
        workspaceId: 'workspace-1',
        userId: 'actor-1',
        issueId: 101,
        updatedPropertyIds: [SystemPropertyId.STATUS],
        // FIXME: it's illegal (in terms of business logic) for this array to be empty when updatedPropertyIds contains ASSIGNEE
        propertyChanges: [],
      }

      await listeners.subscribeAssigneeOnIssueUpdated(event)

      expect(tx.property_single_value.findFirst).not.toHaveBeenCalled()
      expect(tx.subscription.findFirst).not.toHaveBeenCalled()
      expect(tx.subscription.create).not.toHaveBeenCalled()
    })
  })
})
