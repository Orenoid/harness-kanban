import { http } from 'msw/core/http'

import type { ProjectDetail, ProjectSummary } from '@repo/shared/project/types'

type CreateProjectsHandlerOptions = {
  projects?: ProjectSummary[]
}

const now = new Date('2026-03-11T00:00:00Z').toISOString()

export const createMockProjects = (): ProjectSummary[] => [
  {
    id: 'project-1',
    name: 'Project Alpha',
    githubRepoUrl: 'https://github.com/harness-kanban/project-alpha',
    repoBaseBranch: 'main',
    checkCiCd: true,
    previewCommands: ['pnpm install', 'pnpm dev'],
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'project-2',
    name: 'Project Beta',
    githubRepoUrl: 'https://github.com/harness-kanban/project-beta',
    repoBaseBranch: 'develop',
    checkCiCd: false,
    previewCommands: ['pnpm dev'],
    createdAt: now,
    updatedAt: now,
  },
]

export const createProjectsHandler = ({
  projects = createMockProjects(),
}: CreateProjectsHandlerOptions = {}): ReturnType<typeof http.get> =>
  http.get('*/api/v1/projects', () =>
    Response.json({
      success: true,
      data: {
        projects,
      },
      error: null,
    }),
  )

export const createProjectDetailHandler = ({
  project = (() => {
    const baseProject = createMockProjects()[0]!

    return {
      ...baseProject,
      workspaceId: 'workspace-123',
      createdBy: 'user-1',
      envConfig: null,
      mcpConfig: null,
    } satisfies ProjectDetail
  })(),
}: {
  project?: ProjectDetail
} = {}): ReturnType<typeof http.get> =>
  http.get(`*/api/v1/projects/${project.id}`, () =>
    Response.json({
      success: true,
      data: {
        project,
      },
      error: null,
    }),
  )
