'use client'

import React, { forwardRef } from 'react'

import { cn } from '@/lib/shadcn/utils'

export interface MarkdownInputProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
}

export const focusMarkdownInputEnd = (input: HTMLTextAreaElement | null) => {
  if (!input) {
    return
  }

  input.focus()
  const end = input.value.length
  input.setSelectionRange(end, end)
}

const MarkdownInputComponent = (
  { value, onChange, className, ...props }: MarkdownInputProps,
  ref: React.ForwardedRef<HTMLTextAreaElement>,
) => {
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={event => onChange(event.target.value)}
      className={cn(
        'placeholder:text-muted-foreground scrollbar-hide field-sizing-content max-h-72 min-h-[100px] w-full resize-none overflow-y-auto bg-transparent px-3 py-3 pb-14 text-sm leading-relaxed outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export const MarkdownInput = forwardRef(MarkdownInputComponent)

MarkdownInput.displayName = 'MarkdownInput'
