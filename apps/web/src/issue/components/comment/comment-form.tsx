'use client'

import React, { useRef, useState } from 'react'

import { MarkdownEditor, MarkdownEditorHandle } from '@/components/core/markdown-editor'
import { Button } from '@/components/ui/button'
import { useUploadBase64Image } from '@/hooks/use-upload-image'
import { useCreateIssueComment } from '@/issue/hooks/use-create-issue-comment'

interface CommentFormProps {
  issueId: number
}

interface CommentFormViewProps {
  content: string
  isPending: boolean
  onContentChange: (content: string) => void
  onSubmit: () => void
  uploadImage: (base64: string) => Promise<string>
  editorRef: React.Ref<MarkdownEditorHandle>
}

export const CommentFormView: React.FC<CommentFormViewProps> = ({
  content,
  isPending,
  onContentChange,
  onSubmit,
  uploadImage,
  editorRef,
}) => {
  return (
    <div className="border-border bg-background relative rounded-sm border">
      <MarkdownEditor
        ref={editorRef}
        value={content}
        onUpdate={onContentChange}
        editable
        placeholder="Write a comment... Markdown syntax is supported"
        uploadImage={uploadImage}
        containerClassName="p-3 pb-12 min-h-[100px]"
        className="overflow-y-auto"
      />
      <div className="absolute bottom-3 right-3">
        <Button variant="default" size="sm" onClick={onSubmit} disabled={isPending || !content?.trim()}>
          Comment
        </Button>
      </div>
    </div>
  )
}

export const CommentForm: React.FC<CommentFormProps> = ({ issueId }) => {
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const [content, setContent] = useState('')
  const { mutate: submitComment, isPending } = useCreateIssueComment(issueId)

  const { mutateAsync } = useUploadBase64Image()
  const uploadImage = async (base64: string): Promise<string> => {
    const result = await mutateAsync(base64)
    return result.url
  }

  const handleSubmit = () => {
    if (!content?.trim()) return
    submitComment(content, {
      onSuccess: () => {
        setContent('')
        editorRef.current?.focusEnd()
      },
    })
  }

  return (
    <CommentFormView
      content={content}
      isPending={isPending}
      onContentChange={setContent}
      onSubmit={handleSubmit}
      uploadImage={uploadImage}
      editorRef={editorRef}
    />
  )
}
