import { http } from 'msw/core/http'

import type { GithubBranchSummary, GithubConnectionStatus, GithubRepositorySummary } from '@repo/shared/github/types'

const now = new Date('2026-04-03T12:00:00Z').toISOString()
const defaultGithubBranchesByRepository: Record<string, GithubBranchSummary[]> = {
  'harness-kanban/project-alpha': [
    {
      name: 'main',
      isDefault: true,
    },
    {
      name: 'release',
      isDefault: false,
    },
    {
      name: 'feature/demo',
      isDefault: false,
    },
  ],
  'harness-kanban/project-beta': [
    {
      name: 'develop',
      isDefault: true,
    },
    {
      name: 'release/next',
      isDefault: false,
    },
    {
      name: 'feature/demo',
      isDefault: false,
    },
  ],
}
const fallbackGithubBranches = defaultGithubBranchesByRepository['harness-kanban/project-alpha']!

export const defaultGithubConnection: GithubConnectionStatus = {
  hasToken: true,
  updatedAt: now,
}

export const createMockGithubRepositories = (): GithubRepositorySummary[] => [
  {
    id: 101,
    fullName: 'harness-kanban/project-alpha',
    githubRepoUrl: 'https://github.com/harness-kanban/project-alpha',
    defaultBranch: 'main',
    isPrivate: true,
  },
  {
    id: 102,
    fullName: 'harness-kanban/project-beta',
    githubRepoUrl: 'https://github.com/harness-kanban/project-beta',
    defaultBranch: 'develop',
    isPrivate: false,
  },
]

export const createMockGithubBranches = (repositoryFullName = 'harness-kanban/project-alpha'): GithubBranchSummary[] =>
  defaultGithubBranchesByRepository[repositoryFullName] ?? fallbackGithubBranches

export const createGithubConnectionHandler = ({
  connection = defaultGithubConnection,
}: {
  connection?: GithubConnectionStatus
} = {}): ReturnType<typeof http.get> =>
  http.get('*/api/v1/github/connection', () =>
    Response.json({
      success: true,
      data: {
        connection,
      },
      error: null,
    }),
  )

export const createUpdateGithubConnectionHandler = ({
  connection = defaultGithubConnection,
}: {
  connection?: GithubConnectionStatus
} = {}): ReturnType<typeof http.put> =>
  http.put('*/api/v1/github/connection', async () =>
    Response.json({
      success: true,
      data: {
        connection,
      },
      error: null,
    }),
  )

export const createDeleteGithubConnectionHandler = (): ReturnType<typeof http.delete> =>
  http.delete('*/api/v1/github/connection', () =>
    Response.json({
      success: true,
      data: {
        connection: {
          hasToken: false,
          updatedAt: null,
        },
      },
      error: null,
    }),
  )

export const createGithubRepositoriesHandler = ({
  repositories = createMockGithubRepositories(),
}: {
  repositories?: GithubRepositorySummary[]
} = {}): ReturnType<typeof http.get> =>
  http.get('*/api/v1/github/repositories', () =>
    Response.json({
      success: true,
      data: {
        repositories,
      },
      error: null,
    }),
  )

export const createGithubBranchesHandler = ({
  branchesByRepository = defaultGithubBranchesByRepository,
}: {
  branchesByRepository?: Record<string, GithubBranchSummary[]>
} = {}): ReturnType<typeof http.get> =>
  http.get('*/api/v1/github/branches', ({ request }) => {
    const repositoryFullName = new URL(request.url).searchParams.get('repository') ?? ''
    const branches =
      branchesByRepository[repositoryFullName] ??
      defaultGithubBranchesByRepository[repositoryFullName] ??
      fallbackGithubBranches

    return Response.json({
      success: true,
      data: {
        branches,
      },
      error: null,
    })
  })
