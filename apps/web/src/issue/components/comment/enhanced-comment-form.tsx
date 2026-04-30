'use client'

import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import React, { useRef, useState } from 'react'

import { focusMarkdownInputEnd, MarkdownInput } from '@/components/core/markdown'
import { Button } from '@/components/ui/button'
import { useCreateIssueComment } from '@/issue/hooks/use-create-issue-comment'
import { cn } from '@/lib/shadcn/utils'

const COMMENT_PLACEHOLDER = 'Write a comment... Markdown syntax is supported.'

interface EnhancedCommentFormProps {
  issueId: number
  className?: string
}

interface EnhancedCommentFormViewProps {
  createComment: (content: string) => Promise<unknown>
  className?: string
}

export const EnhancedCommentFormView: React.FC<EnhancedCommentFormViewProps> = ({ createComment, className }) => {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [content, setContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const resetForm = () => {
    setContent('')

    setTimeout(() => {
      focusMarkdownInputEnd(inputRef.current)
    }, 0)
  }

  const handleSubmit = async () => {
    const markdown = content.trim()

    if (!markdown) {
      toast.error('Please write a comment')
      return
    }
    if (isSubmitting) return

    setIsSubmitting(true)
    try {
      await createComment(markdown)
      toast.success('Comment added successfully')
      resetForm()
    } catch (error) {
      console.error('Failed to create comment:', error)
      toast.error('Failed to create comment. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={cn('border-border bg-background relative rounded-sm border', className)}>
      <MarkdownInput
        ref={inputRef}
        value={content}
        onChange={setContent}
        placeholder={COMMENT_PLACEHOLDER}
        aria-label="Write a comment"
        autoFocus
        className="min-h-[120px]"
      />
      <div className="absolute bottom-3 right-3">
        <Button size="sm" onClick={handleSubmit} disabled={isSubmitting || !content.trim()}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Submitting...
            </>
          ) : (
            'Submit'
          )}
        </Button>
      </div>
    </div>
  )
}

export const EnhancedCommentForm: React.FC<EnhancedCommentFormProps> = ({ issueId, className }) => {
  const { mutateAsync: createComment } = useCreateIssueComment(issueId)

  return <EnhancedCommentFormView createComment={createComment} className={className} />
}
