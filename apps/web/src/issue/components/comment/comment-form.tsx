'use client'

import React, { useRef, useState } from 'react'

import { focusMarkdownInputEnd, MarkdownInput } from '@/components/core/markdown'
import { Button } from '@/components/ui/button'
import { useCreateIssueComment } from '@/issue/hooks/use-create-issue-comment'

const COMMENT_PLACEHOLDER = 'Write a comment... Markdown syntax is supported.'

interface CommentFormProps {
  issueId: number
}

interface CommentFormViewProps {
  content: string
  isPending: boolean
  onContentChange: (content: string) => void
  onSubmit: () => void
  inputRef: React.Ref<HTMLTextAreaElement>
}

export const CommentFormView: React.FC<CommentFormViewProps> = ({
  content,
  isPending,
  onContentChange,
  onSubmit,
  inputRef,
}) => {
  return (
    <div className="border-border bg-background relative rounded-sm border">
      <MarkdownInput
        ref={inputRef}
        value={content}
        onChange={onContentChange}
        placeholder={COMMENT_PLACEHOLDER}
        aria-label="Write a comment"
      />
      <div className="absolute bottom-3 right-3">
        <Button variant="default" size="sm" onClick={onSubmit} disabled={isPending || !content.trim()}>
          Comment
        </Button>
      </div>
    </div>
  )
}

export const CommentForm: React.FC<CommentFormProps> = ({ issueId }) => {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [content, setContent] = useState('')
  const { mutate: submitComment, isPending } = useCreateIssueComment(issueId)

  const handleSubmit = () => {
    const markdown = content.trim()
    if (!markdown) return

    submitComment(markdown, {
      onSuccess: () => {
        setContent('')
        setTimeout(() => {
          focusMarkdownInputEnd(inputRef.current)
        }, 0)
      },
    })
  }

  return (
    <CommentFormView
      content={content}
      isPending={isPending}
      onContentChange={setContent}
      onSubmit={handleSubmit}
      inputRef={inputRef}
    />
  )
}
