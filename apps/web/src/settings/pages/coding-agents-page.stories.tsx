import { StoryLayout } from '../../../.storybook/components'
import { createCodingAgentHandlers } from '../../../.storybook/msw'
import { SettingsCodingAgentsPage } from './coding-agents-page'
import type { Meta, StoryObj } from '@storybook/nextjs'

const meta: Meta<typeof SettingsCodingAgentsPage> = {
  component: SettingsCodingAgentsPage,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    Story => (
      <StoryLayout pathname="/settings/coding-agents">
        <Story />
      </StoryLayout>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof meta>

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

const findFieldByLabel = (
  ownerDocument: Document,
  labelText: string,
): HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | null => {
  const label = Array.from(ownerDocument.querySelectorAll('label')).find(node => node.textContent?.trim() === labelText)
  if (!label?.htmlFor) {
    return null
  }

  return ownerDocument.getElementById(label.htmlFor) as
    | HTMLInputElement
    | HTMLButtonElement
    | HTMLTextAreaElement
    | null
}

const findButtonByText = (ownerDocument: Document, text: string): HTMLButtonElement | null =>
  (Array.from(ownerDocument.querySelectorAll('button')).find(button => {
    const styles = ownerDocument.defaultView?.getComputedStyle(button)

    return (
      button.textContent?.trim() === text &&
      !button.disabled &&
      styles?.visibility !== 'hidden' &&
      styles?.display !== 'none' &&
      styles?.pointerEvents !== 'none'
    )
  }) as HTMLButtonElement | undefined) ?? null

const findCardByText = (canvasElement: HTMLElement, text: string): HTMLElement | null =>
  (Array.from(canvasElement.querySelectorAll('[data-slot="card"]')).find(card => card.textContent?.includes(text)) as
    | HTMLElement
    | undefined) ?? null

export const ManagementFlow: Story = {
  parameters: {
    msw: {
      handlers: {
        codingAgents: createCodingAgentHandlers(),
      },
    },
  },
  play: async ({ canvasElement, userEvent }) => {
    const ownerDocument = canvasElement.ownerDocument

    await waitForCondition(() => canvasElement.textContent?.includes('Saved configurations') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('Primary Codex') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('Legacy Claude Runner') ?? false)

    const addConfigurationButton = findButtonByText(ownerDocument, 'Add configuration')
    if (!addConfigurationButton) {
      throw new Error('Expected the Add configuration button to render for Codex.')
    }

    await userEvent.click(addConfigurationButton)
    await waitForCondition(() => ownerDocument.body.textContent?.includes('Add Codex configuration') ?? false)

    const createNameInput = findFieldByLabel(ownerDocument, 'Name') as HTMLInputElement | null
    const createModelInput = findFieldByLabel(ownerDocument, 'Model') as HTMLInputElement | null
    const createApiKeyInput = findFieldByLabel(ownerDocument, 'API key') as HTMLInputElement | null
    if (!createNameInput || !createModelInput || !createApiKeyInput) {
      throw new Error('Expected the Codex create form fields to render.')
    }

    await userEvent.type(createNameInput, 'Escalation Codex')
    await userEvent.clear(createModelInput)
    await userEvent.type(createModelInput, 'gpt-5.4')
    await userEvent.type(createApiKeyInput, 'sk-storybook-create')

    const createSubmitButton = findButtonByText(ownerDocument, 'Save configuration')
    if (!createSubmitButton) {
      throw new Error('Expected the create submit button to render.')
    }

    await userEvent.click(createSubmitButton)
    await waitForCondition(() => canvasElement.textContent?.includes('Escalation Codex') ?? false)
    await waitForCondition(() => !(ownerDocument.body.textContent?.includes('Add Codex configuration') ?? false))

    if (!canvasElement.textContent?.includes('Legacy Claude Runner')) {
      throw new Error('Expected the saved Claude Code configuration to remain visible after creating a Codex entry.')
    }
  },
}

export const EmptyState: Story = {
  parameters: {
    msw: {
      handlers: {
        codingAgents: createCodingAgentHandlers({
          initialCodingAgents: [],
        }),
      },
    },
  },
  play: async ({ canvasElement }) => {
    await waitForCondition(() => canvasElement.textContent?.includes('No coding agent configurations yet.') ?? false)
  },
}
