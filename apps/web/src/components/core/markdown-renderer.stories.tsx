import React from 'react'

import { MarkdownRenderer } from './markdown-renderer'
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta<typeof MarkdownRenderer> = {
  title: 'Core/MarkdownRenderer',
  component: MarkdownRenderer,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: {
    content: '',
  },
}

export const PlainText: Story = {
  args: {
    content: 'This is a simple plain text comment.',
  },
}

export const Headings: Story = {
  args: {
    content: `# Heading 1
## Heading 2
### Heading 3
#### Heading 4`,
  },
}

export const Lists: Story = {
  args: {
    content: `- Unordered item 1
- Unordered item 2
  - Nested item

1. Ordered item 1
2. Ordered item 2`,
  },
}

export const CodeBlocks: Story = {
  args: {
    content: `Inline \`code\` example.

\`\`\`typescript
const greeting = "Hello, world!"
console.log(greeting)
\`\`\`

\`\`\`python
def hello():
    print("Hello, world!")
\`\`\``,
  },
}

export const Tables: Story = {
  args: {
    content: `| Feature | Status |
|--------|--------|
| Markdown | Supported |
| WYSIWYG | Supported |
| Images | Supported |`,
  },
}

export const TaskList: Story = {
  args: {
    content: `- [x] Task 1 completed
- [ ] Task 2 pending
- [ ] Task 3 pending`,
  },
}

export const Blockquote: Story = {
  args: {
    content: `> This is a blockquote.
> It can span multiple lines.`,
  },
}

export const MixedContent: Story = {
  args: {
    content: `# Project Update

We have made great progress on the **reimplementation** of comment components.

## Changes
- Markdown rendering support
- WYSIWYG editor
- Backward compatibility

> Note: Existing comments are treated as plain text.

\`\`\`typescript
const editor = new MarkdownEditor()
\`\`\``,
  },
}

export const Playground: Story = {
  args: {
    content: '# Hello\n\nEdit this markdown in the controls panel.',
  },
}
