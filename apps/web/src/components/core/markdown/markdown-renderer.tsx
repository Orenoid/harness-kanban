'use client'

import React, { memo } from 'react'

import { MessageResponse } from '@/components/ai-elements/message'
import { cn } from '@/lib/shadcn/utils'

interface MarkdownRendererProps {
  content: string
  className?: string
}

export const MarkdownRenderer = memo(({ content, className }: MarkdownRendererProps) => {
  if (!content) {
    return null
  }

  return (
    <MessageResponse
      className={cn(
        'prose prose-sm dark:prose-invert prose-no-margins text-primary max-w-none break-words text-sm leading-relaxed',
        '[&_a]:break-words [&_code]:break-words [&_img]:max-w-full [&_pre]:overflow-x-auto',
        className,
      )}>
      {content}
    </MessageResponse>
  )
})

MarkdownRenderer.displayName = 'MarkdownRenderer'
