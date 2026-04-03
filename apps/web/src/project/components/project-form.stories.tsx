import {
  createGithubBranchesHandler,
  createGithubConnectionHandler,
  createGithubRepositoriesHandler,
  createMockGithubBranches,
  createMockGithubRepositories,
} from '../../../.storybook/msw'
import { ProjectForm } from './project-form'
import type { Meta, StoryObj } from '@storybook/nextjs'

const meta = {
  component: ProjectForm,
} satisfies Meta<any>

export default meta

type Story = StoryObj<any>

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

export const CreateMode: Story = {
  parameters: {
    msw: {
      handlers: {
        github: [
          createGithubConnectionHandler(),
          createGithubRepositoriesHandler({ repositories: createMockGithubRepositories() }),
          createGithubBranchesHandler(),
        ],
      },
    },
  },
  render: () => (
    <ProjectForm mode="create" submitLabel="Create project" onCancel={() => {}} onSubmit={async () => {}} />
  ),
  play: async ({ canvasElement, userEvent }) => {
    await waitForCondition(() =>
      Boolean(
        canvasElement.querySelector('#create-project-name') &&
          canvasElement.querySelector('[data-testid="create-project-repo"]') &&
          canvasElement.querySelector('[data-testid="create-project-branch"]') &&
          canvasElement.querySelector('#create-project-mcp-config'),
      ),
    )

    const nameField = canvasElement.querySelector('#create-project-name') as HTMLInputElement | null
    const repoField = canvasElement.querySelector('[data-testid="create-project-repo"]') as HTMLButtonElement | null
    const branchField = canvasElement.querySelector('[data-testid="create-project-branch"]') as HTMLButtonElement | null
    const mcpConfigField = canvasElement.querySelector('#create-project-mcp-config') as HTMLTextAreaElement | null

    if (!nameField || !repoField || !branchField || !mcpConfigField) {
      throw new Error('Expected project form controls to render.')
    }

    await userEvent.type(nameField, 'Project Gamma')
    await userEvent.click(repoField)

    const repoOption = canvasElement.ownerDocument.body.querySelector(
      '[data-testid="create-project-repo-option-harness-kanban-project-alpha"]',
    ) as HTMLElement | null

    if (!repoOption) {
      throw new Error('Expected repository options to render.')
    }

    await userEvent.click(repoOption)
    await waitForCondition(() => repoField.textContent?.includes('harness-kanban/project-alpha') ?? false)
    await waitForCondition(() => !branchField.disabled)

    await userEvent.click(branchField)

    const branchOption = canvasElement.ownerDocument.body.querySelector(
      '[data-testid="create-project-branch-option-release"]',
    ) as HTMLElement | null

    if (!branchOption) {
      throw new Error('Expected branch options to render.')
    }

    await userEvent.click(branchOption)
    await waitForCondition(() => branchField.textContent?.includes('release') ?? false)

    await userEvent.click(repoField)

    const betaRepoOption = canvasElement.ownerDocument.body.querySelector(
      '[data-testid="create-project-repo-option-harness-kanban-project-beta"]',
    ) as HTMLElement | null

    if (!betaRepoOption) {
      throw new Error('Expected repository switch options to render.')
    }

    await userEvent.click(betaRepoOption)
    await waitForCondition(() => repoField.textContent?.includes('harness-kanban/project-beta') ?? false)
    await waitForCondition(() => branchField.textContent?.includes('develop') ?? false)

    if (!canvasElement.textContent?.includes('Create project')) {
      throw new Error('Expected submit button to render.')
    }

    if (canvasElement.textContent?.includes('GitHub connection required')) {
      throw new Error('Expected the GitHub settings prompt to stay hidden when a token is configured.')
    }

    if (canvasElement.textContent?.includes('Preview commands')) {
      throw new Error('Expected preview commands section to be removed from create mode.')
    }

    if (!mcpConfigField.placeholder.includes('"docs"')) {
      throw new Error('Expected MCP config example placeholder to render.')
    }

    if (
      !canvasElement.textContent?.includes(
        'Store project-level MCP servers for Codex. This config is loaded only when a new workspace is created, and existing workspaces stay unchanged.',
      )
    ) {
      throw new Error('Expected MCP config helper text to render.')
    }
  },
}

export const CreateModeWithoutToken: Story = {
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
          createGithubRepositoriesHandler({ repositories: [] }),
          createGithubBranchesHandler({ branchesByRepository: {} }),
        ],
      },
    },
  },
  render: () => (
    <ProjectForm mode="create" submitLabel="Create project" onCancel={() => {}} onSubmit={async () => {}} />
  ),
  play: async ({ canvasElement }) => {
    await waitForCondition(() => canvasElement.textContent?.includes('GitHub connection required') ?? false)

    const settingsLink = canvasElement.querySelector('a[href="/settings/connections"]') as HTMLAnchorElement | null
    const submitButton = Array.from(canvasElement.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Create project'),
    ) as HTMLButtonElement | undefined

    if (!settingsLink) {
      throw new Error('Expected a direct link to settings when the GitHub token is missing.')
    }

    if (!submitButton?.disabled) {
      throw new Error('Expected create project submission to be disabled without a GitHub token.')
    }
  },
}

export const UpdateMode: Story = {
  render: () => (
    <ProjectForm
      mode="update"
      submitLabel="Save changes"
      onSubmit={async () => {}}
      initialProject={{
        id: 'project-1',
        name: 'Project Alpha',
        githubRepoUrl: 'https://github.com/harness-kanban/project-alpha',
        repoBaseBranch: 'main',
        checkCiCd: true,
        previewCommands: ['pnpm install', 'pnpm dev'],
        mcpConfig: {
          docs: {
            type: 'streamable-http',
            url: 'https://example.com/mcp',
          },
        },
        workspaceId: 'workspace-123',
        createdBy: 'user-1',
        createdAt: '2026-03-11T00:00:00Z',
        updatedAt: '2026-03-11T00:00:00Z',
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitForCondition(() =>
      Boolean(canvasElement.querySelector('a[href="https://github.com/harness-kanban/project-alpha"]')),
    )

    const repoField = canvasElement.querySelector('[data-testid="update-project-repo"]') as HTMLElement | null
    const repoLink = canvasElement.querySelector(
      'a[href="https://github.com/harness-kanban/project-alpha"]',
    ) as HTMLAnchorElement | null
    if (repoField) {
      throw new Error('Expected update mode repository field to render as read-only text instead of an input.')
    }

    if (!repoLink) {
      throw new Error('Expected read-only repository text to render in update mode.')
    }

    if (canvasElement.textContent?.includes('Preview commands')) {
      throw new Error('Expected preview commands section to be removed from update mode.')
    }

    const mcpConfigField = canvasElement.querySelector('#update-project-mcp-config') as HTMLTextAreaElement | null
    await waitForCondition(() => Boolean(mcpConfigField?.value.includes('"docs"')))
    if (!mcpConfigField?.value.includes('"docs"')) {
      throw new Error('Expected existing MCP config to render in update mode.')
    }
  },
}
