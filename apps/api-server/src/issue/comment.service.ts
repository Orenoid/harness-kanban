import { PrismaService } from '@/database/prisma.service'
import { ISSUE_EVENTS } from '@/event-bus/constants/event.constants'
import { emit, emitInTx } from '@/event-bus/event-bus'
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { DEFAULT_WORKSPACE_ID } from '@repo/shared/constants'
import { ActivityType } from '@repo/shared/issue/constants'
import { Comment } from '@repo/shared/issue/types'
import { CommentActivityDBPayload } from './types/activity.types'
import type { comment as CommentRecord } from '@repo/database'

type CommentRecordWithChildren = CommentRecord & { children?: CommentRecord[] }

@Injectable()
export class CommentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createComment(issueId: number, content: string, createdBy: string, parentId?: string): Promise<Comment> {
    const issueRecord = await this.prisma.client.issue.findFirst({
      where: {
        id: issueId,
        deleted_at: null,
      },
      select: {
        workspace_id: true,
      },
    })

    if (!issueRecord) {
      throw new ForbiddenException(`Issue ${issueId} not found`)
    }

    // check if the parent comment exists
    if (parentId) {
      const parentCommentExists = await this.prisma.client.comment
        .count({
          where: {
            id: parentId,
            deleted_at: null,
            parent_id: null, // multi-level comments not supported yet
          },
        })
        .then(Boolean)

      if (!parentCommentExists) {
        throw new ForbiddenException(`Parent comment with ID ${parentId} not found`)
      }
    }

    const comment = await this.prisma.client.$transaction(async tx => {
      const newComment = await tx.comment.create({
        data: {
          issue_id: issueId,
          content,
          created_by: createdBy,
          parent_id: parentId || null,
        },
      })

      // only top-level comments create activity records
      if (parentId === undefined) {
        const payload: CommentActivityDBPayload = {
          commentId: newComment.id,
        }
        await tx.activity.create({
          data: {
            issue_id: issueId,
            created_by: createdBy,
            type: ActivityType.COMMENT,
            payload,
          },
        })
      }

      // Add subscription for comment creator
      const { isSubscribedToIssue, isSubscribedToComment: isSubscribedToParentComment } =
        await this.checkUserSubscriptions(createdBy, issueId, parentId)

      const subscriptionData: Array<{
        user_id: string
        issue_id: number
        comment_id: string | null
      }> = []
      if (!isSubscribedToIssue) {
        subscriptionData.push({
          user_id: createdBy,
          issue_id: issueId,
          comment_id: null,
        })
      }
      if (parentId) {
        // If the new comment is a reply, then subscribe to the parent comment
        if (!isSubscribedToParentComment) {
          subscriptionData.push({
            user_id: createdBy,
            issue_id: issueId,
            comment_id: parentId,
          })
        }
      } else {
        // subscribe to the comment itself if it's a top-level comment
        subscriptionData.push({
          user_id: createdBy,
          issue_id: issueId,
          comment_id: parentId || newComment.id,
        })
      }
      await tx.subscription.createMany({ data: subscriptionData })

      await emitInTx(this.eventEmitter, tx, ISSUE_EVENTS.COMMENT_CREATED_IN_TX, {
        workspaceId: issueRecord.workspace_id ?? DEFAULT_WORKSPACE_ID,
        userId: createdBy,
        issueId,
        commentId: newComment.id,
      })

      return newComment
    })

    emit(this.eventEmitter, ISSUE_EVENTS.COMMENT_CREATED, {
      workspaceId: issueRecord.workspace_id ?? DEFAULT_WORKSPACE_ID,
      userId: createdBy,
      issueId,
      commentId: comment.id,
    })

    return {
      id: comment.id,
      issueId: Number(comment.issue_id),
      content: comment.content,
      createdBy: comment.created_by,
      parentId: comment.parent_id,
      createdAt: comment.created_at.getTime(),
      updatedAt: comment.updated_at.getTime(),
    }
  }

  async queryComments(issueId: number): Promise<Comment[]> {
    const issueExists = await this.prisma.client.issue
      .count({
        where: {
          id: issueId,
          deleted_at: null,
        },
      })
      .then(Boolean)

    if (!issueExists) {
      throw new ForbiddenException(`Issue ${issueId} not found`)
    }

    const comments = await this.prisma.client.comment.findMany({
      where: {
        issue_id: issueId,
        parent_id: null,
        deleted_at: null,
      },
      include: {
        children: {
          where: {
            deleted_at: null,
          },
          orderBy: {
            created_at: 'asc',
          },
        },
      },
      orderBy: {
        created_at: 'asc',
      },
    })

    return this.mapCommentsToInterface(comments)
  }

  async getCommentById(commentId: string): Promise<Comment> {
    const record = await this.prisma.client.comment.findFirst({
      where: {
        id: commentId,
        deleted_at: null,
      },
      include: {
        children: {
          where: { deleted_at: null },
          orderBy: { created_at: 'asc' },
        },
      },
    })

    if (!record) {
      throw new NotFoundException(`Comment ${commentId} not found`)
    }

    return this.mapCommentToInterface(record)
  }

  async updateComment(userId: string, commentID: string, content: string): Promise<Comment> {
    const existingComment = await this.prisma.client.comment.findFirst({
      where: {
        id: commentID,
        deleted_at: null,
      },
    })
    if (!existingComment) {
      throw new NotFoundException('Comment not found')
    }
    if (existingComment.created_by !== userId) {
      throw new ForbiddenException('You can only edit your own comments')
    }

    const updatedComment = await this.prisma.client.comment.update({
      where: {
        id: commentID,
      },
      data: {
        content,
        updated_at: new Date(),
      },
      include: {
        children: {
          where: { deleted_at: null },
          orderBy: { created_at: 'asc' },
        },
      },
    })

    return this.mapCommentToInterface(updatedComment)
  }

  async deleteComment(userId: string, commentId: string): Promise<void> {
    const existingComment = await this.prisma.client.comment.findFirst({
      where: {
        id: commentId,
        deleted_at: null,
      },
    })

    if (!existingComment) {
      throw new NotFoundException(`Comment not found`)
    }

    if (existingComment.created_by !== userId) {
      throw new ForbiddenException('You can only delete your own comments')
    }

    await this.prisma.client.$transaction(async tx => {
      // Soft delete the comment and all its children
      await tx.comment.updateMany({
        where: {
          OR: [{ id: commentId }, { parent_id: commentId }],
        },
        data: {
          deleted_at: new Date(),
        },
      })

      // Delete associated subscriptions
      await tx.subscription.deleteMany({
        where: {
          OR: [
            { comment_id: commentId },
            {
              comment_id: {
                in: await tx.comment
                  .findMany({
                    where: { parent_id: commentId },
                    select: { id: true },
                  })
                  .then(comments => comments.map(c => c.id)),
              },
            },
          ],
        },
      })
    })
  }

  private mapCommentToInterface(comment: CommentRecordWithChildren): Comment {
    return {
      id: comment.id,
      issueId: comment.issue_id,
      content: comment.content,
      createdBy: comment.created_by,
      parentId: comment.parent_id,
      createdAt: comment.created_at.getTime(),
      updatedAt: comment.updated_at.getTime(),
      subComments: comment.children ? this.mapCommentsToInterface(comment.children) : [],
    }
  }

  private mapCommentsToInterface(comments: CommentRecordWithChildren[]): Comment[] {
    return comments.map(comment => this.mapCommentToInterface(comment))
  }

  private async checkUserSubscriptions(userId: string, issueId: number, commentId?: string) {
    const subscriptions = await this.prisma.client.subscription.findMany({
      where: {
        user_id: userId,
        issue_id: issueId,
        OR: [
          { comment_id: null }, // Subscription to the issue
          { comment_id: commentId }, // Subscription to the comment (if commentID exists)
        ],
      },
    })

    const isSubscribedToIssue = subscriptions.some(sub => sub.comment_id === null)
    const isSubscribedToComment = commentId ? subscriptions.some(sub => sub.comment_id === commentId) : false

    return { isSubscribedToIssue, isSubscribedToComment }
  }
}
