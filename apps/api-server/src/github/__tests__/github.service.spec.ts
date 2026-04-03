import { PrismaService } from '@/database/prisma.service'
import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { encryptGithubToken } from '../github-token.crypto'
import { GithubService } from '../github.service'

describe('GithubService', () => {
  let service: GithubService
  let prismaService: jest.Mocked<PrismaService>
  let configService: jest.Mocked<ConfigService>
  let originalFetch: typeof fetch
  let fetchMock: jest.Mock
  const workspaceId = 'default-workspace-id'

  const createJsonResponse = (body: unknown) =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as Response

  beforeEach(() => {
    prismaService = {
      client: {
        workspace_github_connection: {
          findUnique: jest.fn(),
          upsert: jest.fn(),
          deleteMany: jest.fn(),
        },
      },
    } as unknown as jest.Mocked<PrismaService>

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'BETTER_AUTH_SECRET') {
          return 'unit-test-secret'
        }

        return undefined
      }),
    } as unknown as jest.Mocked<ConfigService>

    originalFetch = global.fetch
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    service = new GithubService(prismaService, configService)
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('validates and encrypts the token before storing it', async () => {
    const updatedAt = new Date('2026-04-03T12:00:00.000Z')
    fetchMock.mockResolvedValue(createJsonResponse({ login: 'octo-user' }))
    ;(prismaService.client.workspace_github_connection.upsert as jest.Mock).mockResolvedValue({})
    ;(prismaService.client.workspace_github_connection.findUnique as jest.Mock).mockResolvedValue({
      github_token_encrypted: 'encrypted-token',
      github_token_updated_at: updatedAt,
    })

    await expect(service.updateConnection(workspaceId, { token: '  ghp_test_token  ' })).resolves.toEqual({
      hasToken: true,
      updatedAt: updatedAt.toISOString(),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_test_token',
        }),
      }),
    )

    expect(prismaService.client.workspace_github_connection.upsert).toHaveBeenCalledWith({
      where: { workspace_id: workspaceId },
      create: expect.objectContaining({
        workspace_id: workspaceId,
        github_token_encrypted: expect.any(String),
        github_token_updated_at: expect.any(Date),
      }),
      update: expect.objectContaining({
        github_token_encrypted: expect.any(String),
        github_token_updated_at: expect.any(Date),
      }),
    })
    expect(
      (prismaService.client.workspace_github_connection.upsert as jest.Mock).mock.calls[0]?.[0]?.update
        ?.github_token_encrypted,
    ).not.toBe('ghp_test_token')
  })

  it('loads repositories with the decrypted token and normalizes the payload', async () => {
    ;(prismaService.client.workspace_github_connection.findUnique as jest.Mock).mockResolvedValue({
      github_token_encrypted: encryptGithubToken('ghp_repo_token', 'unit-test-secret'),
    })
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse([
          {
            id: 2,
            full_name: 'harness-kanban/project-beta',
            html_url: 'https://github.com/harness-kanban/project-beta',
            default_branch: 'develop',
            private: true,
          },
          {
            id: 1,
            full_name: 'harness-kanban/project-alpha',
            html_url: 'https://github.com/harness-kanban/project-alpha',
            default_branch: 'main',
            private: false,
          },
        ]),
      )
      .mockResolvedValueOnce(createJsonResponse([]))

    await expect(service.getRepositories(workspaceId)).resolves.toEqual([
      {
        id: 1,
        fullName: 'harness-kanban/project-alpha',
        githubRepoUrl: 'https://github.com/harness-kanban/project-alpha',
        defaultBranch: 'main',
        isPrivate: false,
      },
      {
        id: 2,
        fullName: 'harness-kanban/project-beta',
        githubRepoUrl: 'https://github.com/harness-kanban/project-beta',
        defaultBranch: 'develop',
        isPrivate: true,
      },
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/user/repos?'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_repo_token',
        }),
      }),
    )
  })

  it('marks the repository default branch when listing branches', async () => {
    ;(prismaService.client.workspace_github_connection.findUnique as jest.Mock).mockResolvedValue({
      github_token_encrypted: encryptGithubToken('ghp_branch_token', 'unit-test-secret'),
    })
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(createJsonResponse([{ name: 'feature-x' }, { name: 'main' }]))
      .mockResolvedValueOnce(createJsonResponse([]))

    await expect(service.getBranches(workspaceId, 'harness-kanban/project-alpha')).resolves.toEqual([
      { name: 'main', isDefault: true },
      { name: 'feature-x', isDefault: false },
    ])
  })

  it('rejects repository requests when the workspace has not configured a token', async () => {
    ;(prismaService.client.workspace_github_connection.findUnique as jest.Mock).mockResolvedValue({
      github_token_encrypted: null,
    })

    await expect(service.getRepositories(workspaceId)).rejects.toThrow(
      new BadRequestException('GitHub token is not configured. Open Settings > Connections to add one.'),
    )
  })
})
