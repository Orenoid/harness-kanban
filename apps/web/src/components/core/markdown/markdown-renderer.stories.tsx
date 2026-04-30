import { MarkdownRenderer } from './markdown-renderer'
import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta<typeof MarkdownRenderer> = {
  title: 'Core/Markdown/MarkdownRenderer',
  component: MarkdownRenderer,
  decorators: [
    Story => (
      <div className="w-[640px] p-4">
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof MarkdownRenderer>

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

export const Markdown: Story = {
  args: {
    content: `## Plan

Comments now support **markdown**:

- lists
- links like https://example.com
- inline \`code\`

> Existing plain text still renders normally.`,
  },
  play: async ({ canvasElement }) => {
    await waitForCondition(() => canvasElement.textContent?.includes('Comments now support') ?? false)

    if (!canvasElement.textContent?.includes('inline code')) {
      throw new Error('Expected markdown content to render.')
    }
  },
}

export const LegacyJsonLookingText: Story = {
  args: {
    content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Old content"}]}]}',
  },
  play: async ({ canvasElement }) => {
    await waitForCondition(() => canvasElement.textContent?.includes('"type":"doc"') ?? false)
  },
}
