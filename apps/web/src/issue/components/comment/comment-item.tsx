'use client'

import { Check, X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

import { UserDisplay } from '@/components/common/user-display'
import { focusMarkdownInputEnd, MarkdownInput, MarkdownRenderer } from '@/components/core/markdown'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDeleteIssueComment } from '@/issue/hooks/use-delete-issue-comment'
import { useUpdateIssueComment } from '@/issue/hooks/use-update-issue-comment'
import { cn } from '@/lib/shadcn/utils'
import { Comment } from '@repo/shared/issue/types'
import { formatRelativeDate } from '@repo/shared/lib/utils/datetime'

interface CommentItemProps {
  comment: Comment
}

interface CommentItemViewProps extends CommentItemProps {
  updateComment: (
    payload: { commentId: string; content: string },
    options?: {
      onSuccess?: () => void
      onError?: () => void
    },
  ) => void
  isPending: boolean
  deleteComment: (
    payload: { commentId: string },
    options?: {
      onSuccess?: () => void
      onError?: () => void
    },
  ) => void
  isDeleting: boolean
}

export const CommentItemView: React.FC<CommentItemViewProps> = ({
  comment,
  updateComment,
  isPending,
  deleteComment,
  isDeleting,
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(comment.content)
  const [displayContent, setDisplayContent] = useState(comment.content)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastSyncedContentRef = useRef(comment.content)

  const handleEdit = () => {
    setEditContent(displayContent)
    setIsEditing(true)

    setTimeout(() => {
      focusMarkdownInputEnd(inputRef.current)
    }, 0)
  }

  const handleSave = () => {
    const nextContent = editContent.trim()
    if (!nextContent) return

    const previousContent = displayContent
    setDisplayContent(nextContent)
    setEditContent(nextContent)
    setIsEditing(false)

    updateComment(
      { commentId: comment.id, content: nextContent },
      {
        onError: () => {
          setDisplayContent(previousContent)
          setEditContent(previousContent)
          setIsEditing(true)
        },
      },
    )
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditContent(displayContent)
  }

  const handleDelete = () => {
    deleteComment(
      { commentId: comment.id },
      {
        onSuccess: () => {
          setIsDeleteDialogOpen(false)
        },
        onError: () => {
          setIsDeleteDialogOpen(false)
        },
      },
    )
  }

  useEffect(() => {
    if (isEditing || lastSyncedContentRef.current === comment.content) {
      return
    }

    lastSyncedContentRef.current = comment.content
    setEditContent(comment.content)
    setDisplayContent(comment.content)
  }, [comment.content, isEditing])

  return (
    <div data-comment-item className="bg-muted/50 dark:bg-muted/20 group relative rounded-sm px-3 py-2">
      <div className="flex h-6 items-center justify-between gap-2 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <UserDisplay userId={comment.createdBy} />
          <span className="text-muted-foreground shrink-0 text-xs">
            {formatRelativeDate(Number(comment.createdAt))}
          </span>
        </div>
        <div
          className={cn(
            'items-center gap-2',
            isEditing ? 'hidden' : 'hidden group-focus-within:flex group-hover:flex',
          )}>
          <Button variant="ghost" size="sm" onClick={handleEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsDeleteDialogOpen(true)}>
            Delete
          </Button>
        </div>
      </div>

      <div className="mt-2 px-1">
        {isEditing ? (
          <div className="bg-background dark:bg-accent/50 relative rounded-sm border">
            <MarkdownInput
              ref={inputRef}
              value={editContent}
              onChange={setEditContent}
              placeholder="Edit your comment... Markdown syntax is supported."
              aria-label="Edit comment"
              disabled={isPending}
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={handleCancel} disabled={isPending}>
                <X className="h-4 w-4" />
                <span className="sr-only">Cancel edit</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={handleSave} disabled={isPending || !editContent.trim()}>
                <Check className="h-4 w-4" />
                <span className="sr-only">Save edit</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-h-16">
            <MarkdownRenderer content={displayContent} />
          </div>
        )}
      </div>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Comment</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this comment? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Yes, Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const CommentItem: React.FC<CommentItemProps> = ({ comment }) => {
  const { mutate: updateComment, isPending } = useUpdateIssueComment(comment.issueId)
  const { mutate: deleteComment, isPending: isDeleting } = useDeleteIssueComment(comment.issueId)

  return (
    <CommentItemView
      comment={comment}
      updateComment={updateComment}
      isPending={isPending}
      deleteComment={deleteComment}
      isDeleting={isDeleting}
    />
  )
}
