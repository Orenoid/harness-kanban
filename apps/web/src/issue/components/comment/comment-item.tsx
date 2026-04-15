'use client'

import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import { UserDisplay } from '@/components/common/user-display'
import { MarkdownEditor, MarkdownEditorHandle } from '@/components/core/markdown-editor'
import { MarkdownRenderer } from '@/components/core/markdown-renderer'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUploadBase64Image } from '@/hooks/use-upload-image'
import { useDeleteIssueComment } from '@/issue/hooks/use-delete-issue-comment'
import { useUpdateIssueComment } from '@/issue/hooks/use-update-issue-comment'
import { cn } from '@/lib/shadcn/utils'
import { Comment } from '@repo/shared/issue/types'
import { formatRelativeDate } from '@repo/shared/lib/utils/datetime'
import { CommentPropertyForm } from './comment-property/comment-property-form'
import { CommentPropertyViewer } from './comment-property/comment-property-viewer'
import { getCommentMarkdown, parseCommentContent, stringifyCommentContent } from './comment-property/parser'
import { getCommentPropertiesByData, getCommentTheme, getDisplayCommentProperties } from './comment-property/registry'
import { CommentPropertyValueType } from './comment-property/types'

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
  uploadImage: (base64: string) => Promise<string>
}

export const CommentItemView: React.FC<CommentItemViewProps> = ({
  comment,
  updateComment,
  isPending,
  deleteComment,
  isDeleting,
  uploadImage,
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [displayContent, setDisplayContent] = useState(comment.content)
  const [propertyValues, setPropertyValues] = useState<Record<string, CommentPropertyValueType>>({})
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const editorRef = useRef<MarkdownEditorHandle>(null)

  const parsedContent = parseCommentContent(displayContent)
  const commentProperties = useMemo(() => {
    return getDisplayCommentProperties(parsedContent.attr?.data || {})
  }, [parsedContent.attr?.data])

  const theme = getCommentTheme(parsedContent.attr?.data || {})

  const handleEdit = () => {
    const parsed = parseCommentContent(comment.content)
    setIsEditing(true)
    setEditContent(getCommentMarkdown(parsed))
    setPropertyValues(parsed.attr?.data || {})
  }

  const handlePropertyChange = (propertyId: string, value: CommentPropertyValueType) => {
    setPropertyValues(prev => ({
      ...prev,
      [propertyId]: value,
    }))
  }

  const handleSave = () => {
    const editorValue = editorRef.current?.getValue()
    if (!editorValue?.trim() && Object.keys(propertyValues).length === 0) return

    try {
      let newContent: { content?: string; attr?: { data: Record<string, CommentPropertyValueType> } }

      const originalData = parseCommentContent(comment.content).attr?.data || {}
      const readonlyData: Record<string, CommentPropertyValueType> = {}

      const allProperties = getCommentPropertiesByData(originalData)
      allProperties.forEach(property => {
        if (property.meta.readonly && originalData[property.id] !== undefined) {
          readonlyData[property.id] = originalData[property.id]
        }
      })

      const finalData = { ...readonlyData, ...propertyValues }

      if (editorValue) {
        newContent =
          Object.keys(finalData).length > 0
            ? { content: editorValue, attr: { data: finalData } }
            : { content: editorValue }
      } else {
        newContent = { content: '', attr: { data: finalData } }
      }

      const contentString = stringifyCommentContent(newContent)

      setDisplayContent(contentString)
      setIsEditing(false)

      updateComment(
        { commentId: comment.id, content: contentString },
        {
          onSuccess: () => {},
          onError: () => {
            setDisplayContent(comment.content)
            setIsEditing(true)
          },
        },
      )
    } catch (error) {
      toast.error('Failed to save comment: ' + (error instanceof Error ? error.message : 'Unknown error'))
      console.error('Failed to save comment:', error)
    }
  }

  const handleCancel = () => {
    setIsEditing(false)
    const parsed = parseCommentContent(comment.content)
    setEditContent(getCommentMarkdown(parsed))
    setPropertyValues(parsed.attr?.data || {})
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

  const renderProperties = () => {
    if (commentProperties.length === 0) return null

    return (
      <div className="flex flex-wrap gap-2">
        {commentProperties.map(property => {
          const value = parsedContent.attr?.data[property.id]
          return (
            <CommentPropertyViewer
              key={property.id}
              property={property}
              value={value}
              className={cn(theme?.text, theme?.container)}
            />
          )
        })}
      </div>
    )
  }

  const renderEditingProperties = () => {
    const allProperties = getCommentPropertiesByData(propertyValues)
    if (allProperties.length === 0) return null

    const editableProperties = allProperties.filter(p => !p.meta.readonly)
    const readonlyProperties = allProperties.filter(p => p.meta.readonly)

    return (
      <div className="border-border bg-muted/30 border-b p-4">
        {readonlyProperties.length > 0 && (
          <div className="border-border/50 mb-4 border-b pb-4">
            <div className="flex gap-4">
              {readonlyProperties.map(property => {
                const value = propertyValues[property.id]
                if (!value) return null
                return (
                  <div key={property.id} className="text-sm">
                    <span className="text-muted-foreground font-medium">
                      {property.meta.display?.label || property.id}:
                    </span>{' '}
                    <CommentPropertyViewer property={property} value={value} />
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {editableProperties.length > 0 && (
          <div className="flex gap-4">
            {editableProperties.map(property => (
              <div key={property.id} className="flex-1">
                <CommentPropertyForm
                  property={property}
                  value={propertyValues[property.id]}
                  onChange={value => handlePropertyChange(property.id, value)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  useEffect(() => {
    if (!isEditing) {
      const parsed = parseCommentContent(comment.content)
      setEditContent(getCommentMarkdown(parsed))
      setDisplayContent(comment.content)
      setPropertyValues(parsed.attr?.data || {})
    }
  }, [comment.content, isEditing])

  const displayMarkdown = getCommentMarkdown(parsedContent)

  return (
    <div className={cn('group relative rounded-sm border p-3', theme?.container || 'bg-background dark:bg-accent/50')}>
      <div className="flex h-6 items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <UserDisplay userId={comment.createdBy} />
          <span className="text-muted-foreground text-xs">{formatRelativeDate(Number(comment.createdAt))}</span>
        </div>
        <div className="hidden items-center gap-2 group-hover:flex">
          {!isEditing && (
            <>
              <Button variant="ghost" size="sm" onClick={handleEdit}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsDeleteDialogOpen(true)}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="mt-2 px-1 text-sm leading-relaxed">
        {isEditing ? (
          <div className="bg-background dark:bg-accent/50 relative rounded-sm border">
            {renderEditingProperties()}
            <MarkdownEditor
              ref={editorRef}
              defaultValue={editContent}
              updateMode="manual"
              editable
              placeholder="Edit your comment... Markdown syntax is supported"
              uploadImage={uploadImage}
              containerClassName="p-3 pb-12 min-h-[80px]"
              className="overflow-y-auto"
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={handleCancel} disabled={isPending}>
                <X className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleSave} disabled={isPending || !editContent?.trim()}>
                <Check className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-16">
              <MarkdownRenderer content={displayMarkdown} />
            </div>
            {renderProperties()}
            <h3 className={cn(theme?.text, 'absolute bottom-3 right-3 text-3xl font-bold opacity-40')}>
              {theme?.label}
            </h3>
          </>
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
  const { mutateAsync: uploadBase64Image } = useUploadBase64Image()

  const uploadImage = async (base64: string): Promise<string> => {
    const result = await uploadBase64Image(base64)
    return result.url
  }

  return (
    <CommentItemView
      comment={comment}
      updateComment={updateComment}
      isPending={isPending}
      deleteComment={deleteComment}
      isDeleting={isDeleting}
      uploadImage={uploadImage}
    />
  )
}
