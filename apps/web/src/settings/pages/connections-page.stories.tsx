import { StoryLayout } from '../../../.storybook/components'
import {
  createDeleteGithubConnectionHandler,
  createGithubConnectionHandler,
  createUpdateGithubConnectionHandler,
} from '../../../.storybook/msw'
import { SettingsConnectionsPage } from './connections-page'
import type { Meta, StoryObj } from '@storybook/nextjs'

const meta: Meta<typeof SettingsConnectionsPage> = {
  component: SettingsConnectionsPage,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    Story => (
      <StoryLayout pathname="/settings/connections">
        <Story />
      </StoryLayout>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof meta>

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

export const Connected: Story = {
  parameters: {
    msw: {
      handlers: {
        github: [
          createGithubConnectionHandler(),
          createUpdateGithubConnectionHandler(),
          createDeleteGithubConnectionHandler(),
        ],
      },
    },
  },
  play: async ({ canvasElement }) => {
    await waitForCondition(() => canvasElement.textContent?.includes('GitHub') ?? false)
    await waitForCondition(
      () =>
        canvasElement.textContent?.includes('A GitHub token is already saved. Paste a new one here to replace it.') ??
        false,
    )

    if (!canvasElement.textContent?.includes('A GitHub token is already saved. Paste a new one here to replace it.')) {
      throw new Error('Expected the saved GitHub token helper text to render.')
    }

    const tokenInput = canvasElement.querySelector('#github-token') as HTMLInputElement | null
    if (!tokenInput) {
      throw new Error('Expected the GitHub token input to render.')
    }

    if (tokenInput.placeholder !== '********************') {
      throw new Error('Expected the saved token state to render a masked placeholder.')
    }
  },
}

export const NotConnected: Story = {
  parameters: {
    msw: {
      handlers: {
        github: [
          createGithubConnectionHandler({
            connection: {
              hasToken: false,
              updatedAt: null,
            },
          }),
          createUpdateGithubConnectionHandler(),
        ],
      },
    },
  },
  play: async ({ canvasElement, userEvent }) => {
    await waitForCondition(() => canvasElement.textContent?.includes('How to get your GitHub token:') ?? false)

    if (canvasElement.textContent?.includes('A GitHub token is already saved. Paste a new one here to replace it.')) {
      throw new Error('Expected the saved helper text to stay hidden before a token is added.')
    }

    const tokenInput = canvasElement.querySelector('#github-token') as HTMLInputElement | null
    const saveButton = Array.from(canvasElement.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Save token'),
    ) as HTMLButtonElement | undefined

    if (!tokenInput || !saveButton) {
      throw new Error('Expected the GitHub token form to render.')
    }

    await userEvent.type(tokenInput, 'ghp_exampletoken1234567890')
    await userEvent.click(saveButton)
    await waitForCondition(
      () =>
        canvasElement.textContent?.includes('A GitHub token is already saved. Paste a new one here to replace it.') ??
        false,
    )
  },
}
