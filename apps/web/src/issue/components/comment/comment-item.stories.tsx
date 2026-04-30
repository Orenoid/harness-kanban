import { CommentItemView } from './comment-item'
import type { Comment } from '@repo/shared/issue/types'
import type { Meta, StoryObj } from '@storybook/react'

const baseComment: Comment = {
  id: 'comment-1',
  issueId: 482,
  content: `## Implementation notes

The renderer supports **markdown** and keeps old records as plain text.

- Create comments as markdown strings
- Render comments with the shared markdown renderer
- Edit comments with the markdown editor`,
  createdBy: 'user-2',
  parentId: null,
  createdAt: Date.parse('2026-04-06T09:12:00Z'),
  updatedAt: Date.parse('2026-04-06T09:12:00Z'),
  subComments: [],
}

const noopMutation = () => {}

const meta: Meta<typeof CommentItemView> = {
  title: 'Issue/CommentItem',
  component: CommentItemView,
  args: {
    comment: baseComment,
    updateComment: noopMutation,
    isPending: false,
    deleteComment: noopMutation,
    isDeleting: false,
  },
  decorators: [
    Story => (
      <div className="w-[720px] p-4">
        <Story />
      </div>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof CommentItemView>

const waitForCondition = async (predicate: () => boolean, timeoutMs = 2000, intervalMs = 50) => {
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
  play: async ({ canvasElement }) => {
    await waitForCondition(() => canvasElement.textContent?.includes('Implementation notes') ?? false)

    if (!canvasElement.textContent?.includes('Create comments as markdown strings')) {
      throw new Error('Expected markdown list content to render.')
    }

    const commentItem = canvasElement.querySelector('[data-comment-item]')
    if (!commentItem) {
      throw new Error('Expected comment item to render.')
    }

    if (getComputedStyle(commentItem).borderTopWidth !== '0px') {
      throw new Error('Comment item should not render a card border.')
    }

    if (getComputedStyle(commentItem).backgroundColor === 'rgba(0, 0, 0, 0)') {
      throw new Error('Comment item should render a subtle background.')
    }
  },
}

export const LegacyJsonLookingText: Story = {
  args: {
    comment: {
      ...baseComment,
      id: 'comment-json',
      content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Old content"}]}]}',
    },
  },
  play: async ({ canvasElement }) => {
    await waitForCondition(() => canvasElement.textContent?.includes('"type":"doc"') ?? false)
  },
}

export const Editing: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await waitForCondition(() => canvasElement.textContent?.includes('Implementation notes') ?? false)

    const commentShell = canvasElement.querySelector('.group')
    if (!commentShell) {
      throw new Error('Expected comment shell to render.')
    }

    await userEvent.hover(commentShell)

    const editButton = Array.from(canvasElement.querySelectorAll('button')).find(
      button => button.textContent?.trim() === 'Edit',
    )
    if (!editButton) {
      throw new Error('Expected edit button to render.')
    }

    await userEvent.click(editButton)
    await waitForCondition(() => Boolean(canvasElement.querySelector('textarea[aria-label="Edit comment"]')))

    const editInput = canvasElement.querySelector('textarea[aria-label="Edit comment"]')
    if (!(editInput instanceof HTMLTextAreaElement)) {
      throw new Error('Expected edit textarea to render.')
    }

    await userEvent.clear(editInput)
    await userEvent.type(editInput, 'Saved **markdown** stays visible')

    const saveButton = Array.from(canvasElement.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Save edit'),
    )
    if (!saveButton) {
      throw new Error('Expected save button to render.')
    }

    await userEvent.click(saveButton)
    await waitForCondition(() => canvasElement.textContent?.includes('Saved markdown stays visible') ?? false)
  },
}
