import React, { useRef, useState } from 'react'

import { MarkdownEditor, MarkdownEditorHandle } from './markdown-editor'
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta<typeof MarkdownEditor> = {
  title: 'Core/MarkdownEditor',
  component: MarkdownEditor,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    editable: true,
    placeholder: 'Write a comment... Markdown syntax is supported',
    containerClassName: 'p-3 pb-12 min-h-[100px]',
  },
}

export const WithInitialValue: Story = {
  args: {
    editable: true,
    defaultValue: '# Hello\n\nThis is **bold** and *italic*.',
    containerClassName: 'p-3 pb-12 min-h-[100px]',
  },
}

export const Readonly: Story = {
  args: {
    editable: false,
    defaultValue: '# Readonly mode\n\nThis content cannot be edited.',
    containerClassName: 'p-3 pb-12 min-h-[100px]',
  },
}

export const Controlled: Story = {
  render: () => {
    const [value, setValue] = useState('# Controlled Editor\n\nType here...')
    return (
      <div className="space-y-4">
        <MarkdownEditor value={value} onUpdate={setValue} editable containerClassName="p-3 pb-12 min-h-[100px]" />
        <div className="bg-muted rounded-md p-4">
          <p className="text-muted-foreground mb-2 text-sm font-medium">Markdown Output:</p>
          <pre className="text-sm">{value}</pre>
        </div>
      </div>
    )
  },
}

export const ManualMode: Story = {
  render: () => {
    const editorRef = useRef<MarkdownEditorHandle>(null)
    const [submitted, setSubmitted] = useState('')

    return (
      <div className="space-y-4">
        <MarkdownEditor ref={editorRef} updateMode="manual" editable containerClassName="p-3 pb-12 min-h-[100px]" />
        <button
          className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm"
          onClick={() => setSubmitted(editorRef.current?.getValue() || '')}>
          Get Markdown
        </button>
        {submitted && (
          <div className="bg-muted rounded-md p-4">
            <pre className="text-sm">{submitted}</pre>
          </div>
        )}
      </div>
    )
  },
}
