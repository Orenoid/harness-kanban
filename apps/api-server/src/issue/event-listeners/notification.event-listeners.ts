import { PrismaService } from '@/database/prisma.service'
import { ISSUE_EVENTS } from '@/event-bus/constants/event.constants'
import { CommentCreatedEvent, IssueDeletedEvent, IssueUpdatedEvent } from '@/event-bus/types/event.types'
import { IssueService } from '@/issue/issue.service'
import { jsonContentToMarkdown } from '@/lib/utils/markdown'
import { NotificationService } from '@/notification/notification.service'
import { UserService } from '@/user/user.service'
import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { NotificationType, SystemPropertyId } from '@repo/shared'
import type {
  CommentCreatedNotificationPayload,
  IssueDeletedNotificationPayload,
  IssueUpdatedNotificationPayload,
  NotificationActor,
  NotificationIssueReference,
} from '@repo/shared'

const COMMENT_EXCERPT_LIMIT = 180

@Injectable()
export class IssueNotificationEventListeners {
  private readonly logger = new Logger(IssueNotificationEventListeners.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly notificationService: NotificationService,
    private readonly issueService: IssueService,
  ) {}

  @OnEvent(ISSUE_EVENTS.ISSUE_UPDATED)
  async notifyOnIssueUpdated(event: IssueUpdatedEvent): Promise<void> {
    const recipientIds = await this.notificationService.getIssueSubscriberIds(event.issueId, event.userId)
    if (recipientIds.length === 0) {
      return
    }

    const [actor, issue, properties] = await Promise.all([
      this.loadActor(event.userId),
      this.loadIssueReference(event.issueId),
      this.prisma.client.property.findMany({
        where: {
          id: {
            in: event.updatedPropertyIds,
          },
        },
        select: {
          id: true,
          name: true,
        },
      }),
    ])

    const propertyNameById = new Map(properties.map(property => [property.id, property.name]))
    const payload: IssueUpdatedNotificationPayload = {
      actor,
      issue,
      changedProperties: event.updatedPropertyIds.map(propertyId => ({
        propertyId,
        name: propertyNameById.get(propertyId) ?? propertyId,
      })),
    }

    await this.notificationService.createNotification({
      workspaceId: event.workspaceId,
      type: NotificationType.ISSUE_UPDATED,
      payload,
      recipientIds,
    })
  }

  @OnEvent(ISSUE_EVENTS.ISSUE_DELETED)
  async notifyOnIssueDeleted(event: IssueDeletedEvent): Promise<void> {
    const recipientIds = this.notificationService.filterRecipientIds(event.subscriberIds, event.userId)
    if (recipientIds.length === 0) {
      return
    }

    const actor = await this.loadActor(event.userId)
    const payload: IssueDeletedNotificationPayload = {
      actor,
      issue: {
        issueId: event.issueId,
        title: event.issueTitle,
      },
    }

    await this.notificationService.createNotification({
      workspaceId: event.workspaceId,
      type: NotificationType.ISSUE_DELETED,
      payload,
      recipientIds,
    })
  }

  @OnEvent(ISSUE_EVENTS.COMMENT_CREATED)
  async notifyOnCommentCreated(event: CommentCreatedEvent): Promise<void> {
    const comment = await this.prisma.client.comment.findUnique({
      where: {
        id: event.commentId,
      },
      select: {
        id: true,
        issue_id: true,
        content: true,
        created_by: true,
        parent_id: true,
      },
    })

    if (!comment) {
      this.logger.warn(`Comment ${event.commentId} not found for notification delivery`)
      return
    }

    const recipientIds = comment.parent_id
      ? await this.notificationService.getCommentSubscriberIds(comment.parent_id, comment.created_by)
      : await this.notificationService.getIssueSubscriberIds(comment.issue_id, comment.created_by)

    if (recipientIds.length === 0) {
      return
    }

    const [actor, issue] = await Promise.all([
      this.loadActor(comment.created_by),
      this.loadIssueReference(comment.issue_id),
    ])

    const payload: CommentCreatedNotificationPayload = {
      actor,
      issue,
      comment: {
        commentId: comment.id,
        parentId: comment.parent_id,
        excerpt: this.buildCommentExcerpt(comment.content),
      },
    }

    await this.notificationService.createNotification({
      workspaceId: event.workspaceId,
      type: NotificationType.COMMENT_CREATED,
      payload,
      recipientIds,
    })
  }

  private async loadActor(userId: string): Promise<NotificationActor | null> {
    const [actor] = await this.userService.getSpecifiedUsers([userId])
    return actor ?? null
  }

  private async loadIssueReference(issueId: number): Promise<NotificationIssueReference> {
    const title = await this.issueService.getIssueStringPropertyValue(issueId, SystemPropertyId.TITLE)

    return {
      issueId,
      title: title || `Issue #${issueId}`,
    }
  }

  private buildCommentExcerpt(content: string): string {
    try {
      const markdown = this.renderCommentContent(content).replace(/\s+/g, ' ').trim()
      if (!markdown) {
        return 'Open the issue to view the new comment.'
      }

      if (markdown.length <= COMMENT_EXCERPT_LIMIT) {
        return markdown
      }

      return `${markdown.slice(0, COMMENT_EXCERPT_LIMIT).trimEnd()}...`
    } catch (error) {
      this.logger.error(`Failed to render comment excerpt: ${(error as Error).message}`)
      return 'Open the issue to view the new comment.'
    }
  }

  private renderCommentContent(content: string): string {
    const trimmedContent = content.trim()
    if (!trimmedContent) {
      return ''
    }

    if (trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) {
      return jsonContentToMarkdown(trimmedContent)
    }

    return trimmedContent
  }
}
