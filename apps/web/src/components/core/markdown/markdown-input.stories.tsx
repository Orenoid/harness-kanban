import React, { useState } from 'react'

import { MarkdownInput } from './markdown-input'
import type { Meta, StoryObj } from '@storybook/react'
import type { MarkdownInputProps } from './markdown-input'

const MarkdownInputStory = (args: MarkdownInputProps) => {
  const [value, setValue] = useState(args.value)

  return <MarkdownInput {...args} value={value} onChange={setValue} />
}

const meta: Meta<typeof MarkdownInput> = {
  title: 'Core/Markdown/MarkdownInput',
  component: MarkdownInput,
  decorators: [
    Story => (
      <div className="border-border bg-background relative w-[720px] rounded-sm border">
        <Story />
      </div>
    ),
  ],
  render: args => <MarkdownInputStory {...args} />,
}

export default meta

type Story = StoryObj<typeof MarkdownInput>

const waitForCondition = async (predicate: () => boolean, timeoutMs = 1500, intervalMs = 50) => {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  throw new Error('Timed out waiting for condition.')
}

export const Empty: Story = {
  args: {
    value: '',
    placeholder: 'Write a comment... Markdown syntax is supported.',
    'aria-label': 'Write a comment',
  },
  play: async ({ canvasElement }) => {
    await waitForCondition(() => Boolean(canvasElement.querySelector('textarea[aria-label="Write a comment"]')))
  },
}

export const WithMarkdownSyntax: Story = {
  args: {
    value: `## Release Notes

- Add markdown comments
- Render submitted comments`,
    placeholder: 'Write a comment... Markdown syntax is supported.',
    'aria-label': 'Write a comment',
  },
  play: async ({ canvasElement }) => {
    await waitForCondition(() => {
      const input = canvasElement.querySelector('textarea')
      return input instanceof HTMLTextAreaElement && input.value.includes('## Release Notes')
    })
  },
}
