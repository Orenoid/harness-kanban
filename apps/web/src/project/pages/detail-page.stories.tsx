import { useState } from 'react'

import { StoryLayout } from '../../../.storybook/components'
import { ProjectDetailPageView } from './detail-page'
import type { ProjectDetail } from '@repo/shared/project/types'
import type { Meta, StoryObj } from '@storybook/nextjs'

const project: ProjectDetail = {
  id: 'project-1',
  name: 'Project Alpha',
  githubRepoUrl: 'https://github.com/harness-kanban/project-alpha',
  repoBaseBranch: 'main',
  checkCiCd: true,
  previewCommands: ['pnpm install', 'pnpm dev'],
  mcpConfig: null,
  envConfig: null,
  workspaceId: 'workspace-123',
  createdBy: 'user-1',
  createdAt: '2026-03-11T00:00:00Z',
  updatedAt: '2026-03-11T00:00:00Z',
}

const InteractiveProjectDetailPageStory = () => {
  const [searchParams, setSearchParams] = useState(() => new URLSearchParams('tab=kanban'))
  const activeTab = searchParams.get('tab') === 'configuration' ? 'configuration' : 'kanban'

  return (
    <ProjectDetailPageView
      activeTab={activeTab}
      project={project}
      isUpdating={false}
      onTabChange={tab => {
        const nextSearchParams = new URLSearchParams(searchParams.toString())
        nextSearchParams.set('tab', tab)
        setSearchParams(nextSearchParams)
      }}
      onUpdateProject={async () => {}}
    />
  )
}

const meta: Meta<typeof InteractiveProjectDetailPageStory> = {
  component: InteractiveProjectDetailPageStory,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    Story => (
      <StoryLayout pathname="/projects">
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

export const Default: Story = {
  play: async ({ canvasElement, userEvent }) => {
    await waitForCondition(() => canvasElement.textContent?.includes('Project Alpha') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('Sample Issue 1') ?? false)

    const header = canvasElement.querySelector('[data-testid="project-detail-header"]')
    if (!header) {
      throw new Error('Expected the project detail header to render.')
    }

    if (header.className.includes('max-w-6xl') || header.className.includes('container')) {
      throw new Error('Expected the project detail header to use the available page width.')
    }

    const configurationTab = Array.from(canvasElement.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Configuration'),
    ) as HTMLButtonElement | undefined

    if (!configurationTab) {
      throw new Error('Expected configuration tab to render.')
    }

    await userEvent.click(configurationTab)

    if (!canvasElement.textContent?.includes('Configuration')) {
      throw new Error('Expected configuration panel to remain renderable in story layout.')
    }

    const configurationSection = canvasElement.querySelector('[data-testid="project-detail-configuration"]')
    if (!configurationSection) {
      throw new Error('Expected the configuration section to render.')
    }

    if (configurationSection.className.includes('max-w-6xl') || configurationSection.className.includes('container')) {
      throw new Error('Expected the configuration section to use the available page width.')
    }
  },
}
