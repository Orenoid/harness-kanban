import { PrismaService } from '@/database/prisma.service'
import { ConfigService } from '@nestjs/config'
import { HarnessWorkerGithubService } from '../harness-worker-github.service'

describe('HarnessWorkerGithubService', () => {
  let service: HarnessWorkerGithubService
  let prismaService: jest.Mocked<PrismaService>
  let configService: jest.Mocked<ConfigService>
  let originalFetch: typeof fetch
  let fetchMock: jest.Mock

  beforeEach(() => {
    prismaService = {
      client: {
        property_single_value: {
          findFirst: jest.fn().mockResolvedValue({ value: 'project-1' }),
        },
        project: {
          findFirst: jest.fn().mockResolvedValue({
            check_ci_cd: true,
            github_repo_url: 'https://github.com/harness-kanban/payments-api',
            repo_base_branch: 'main',
          }),
        },
        harness_worker: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      },
    } as unknown as jest.Mocked<PrismaService>

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'GITHUB_TOKEN') {
          return 'github-token-value'
        }

        return undefined
      }),
    } as unknown as jest.Mocked<ConfigService>

    originalFetch = global.fetch
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    service = new HarnessWorkerGithubService(prismaService, configService)
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('reuses an existing open pull request for the returned branch', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          number: 17,
          html_url: 'https://github.com/harness-kanban/payments-api/pull/17',
          head: { ref: 'code-bot/issue-101-plan' },
        },
      ],
    })

    await expect(
      service.ensureDraftPullRequest({
        issueId: 101,
        workspaceId: 'workspace-1',
        branchName: 'code-bot/issue-101-plan',
        pullRequestTitle: 'Plan issue 101: Planning workflow',
        pullRequestBody: 'Create the technical plan and keep the rollout small.',
      }),
    ).resolves.toEqual({
      number: 17,
      url: 'https://github.com/harness-kanban/payments-api/pull/17',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('head=harness-kanban%3Acode-bot%2Fissue-101-plan')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.github.com/repos/harness-kanban/payments-api/pulls/17')
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Plan issue 101: Planning workflow',
          body: 'Create the technical plan and keep the rollout small.',
        }),
      }),
    )
  })

  it('creates a new draft pull request when the branch has no open PR', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 18,
          html_url: 'https://github.com/harness-kanban/payments-api/pull/18',
        }),
      })

    await expect(
      service.ensureDraftPullRequest({
        issueId: 101,
        workspaceId: 'workspace-1',
        branchName: 'code-bot/issue-101-plan',
        pullRequestTitle: 'Plan issue 101: Planning workflow',
        pullRequestBody: 'Create the technical plan and keep the rollout small.',
      }),
    ).resolves.toEqual({
      number: 18,
      url: 'https://github.com/harness-kanban/payments-api/pull/18',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.github.com/repos/harness-kanban/payments-api/pulls')
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'Plan issue 101: Planning workflow',
          head: 'code-bot/issue-101-plan',
          base: 'main',
          body: 'Create the technical plan and keep the rollout small.',
          draft: true,
        }),
      }),
    )
  })

  it('loads the technical plan pull request context for requested plan changes', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            number: 17,
            html_url: 'https://github.com/harness-kanban/payments-api/pull/17',
            title: 'Technical plan for issue #101: Planning workflow',
            body: 'Plan body',
            head: { ref: 'code-bot/issue-101-plan' },
            base: { ref: 'main' },
            state: 'open',
            draft: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 1,
            state: 'COMMENTED',
            body: 'Please adjust the rollout section.',
            submitted_at: '2026-03-15T06:30:00.000Z',
            html_url: 'https://github.com/harness-kanban/payments-api/pull/17#pullrequestreview-1',
            user: { login: 'reviewer-1' },
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 2,
            body: 'Expand this test case.',
            path: 'technical_plan.md',
            line: 12,
            side: 'RIGHT',
            created_at: '2026-03-15T06:31:00.000Z',
            updated_at: '2026-03-15T06:31:00.000Z',
            html_url: 'https://github.com/harness-kanban/payments-api/pull/17#discussion_r2',
            user: { login: 'reviewer-1' },
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            id: 3,
            body: 'Top-level PR comment.',
            created_at: '2026-03-15T06:32:00.000Z',
            updated_at: '2026-03-15T06:32:00.000Z',
            html_url: 'https://github.com/harness-kanban/payments-api/pull/17#issuecomment-3',
            user: { login: 'reviewer-2' },
          },
        ],
      })

    await expect(service.getPlanPullRequestContext({ issueId: 101, workspaceId: 'workspace-1' })).resolves.toEqual({
      pullRequest: {
        number: 17,
        url: 'https://github.com/harness-kanban/payments-api/pull/17',
        title: 'Technical plan for issue #101: Planning workflow',
        body: 'Plan body',
        baseBranch: 'main',
        headBranch: 'code-bot/issue-101-plan',
        state: 'open',
        isDraft: true,
      },
      reviews: [
        {
          id: 1,
          state: 'COMMENTED',
          body: 'Please adjust the rollout section.',
          submittedAt: '2026-03-15T06:30:00.000Z',
          url: 'https://github.com/harness-kanban/payments-api/pull/17#pullrequestreview-1',
          userLogin: 'reviewer-1',
        },
      ],
      reviewComments: [
        {
          id: 2,
          body: 'Expand this test case.',
          path: 'technical_plan.md',
          line: 12,
          side: 'RIGHT',
          createdAt: '2026-03-15T06:31:00.000Z',
          updatedAt: '2026-03-15T06:31:00.000Z',
          url: 'https://github.com/harness-kanban/payments-api/pull/17#discussion_r2',
          userLogin: 'reviewer-1',
        },
      ],
      issueComments: [
        {
          id: 3,
          body: 'Top-level PR comment.',
          createdAt: '2026-03-15T06:32:00.000Z',
          updatedAt: '2026-03-15T06:32:00.000Z',
          url: 'https://github.com/harness-kanban/payments-api/pull/17#issuecomment-3',
          userLogin: 'reviewer-2',
        },
      ],
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/repos/harness-kanban/payments-api/pulls?state=open&per_page=100',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('recognizes a technical plan pull request even when the title uses a different issue format', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            number: 22,
            html_url: 'https://github.com/harness-kanban/payments-api/pull/22',
            title: 'Plan issue #101: Keep the rollout tiny',
            body: 'Create the technical plan file for issue 101.',
            head: { ref: 'issue-101-plan' },
            base: { ref: 'main' },
            state: 'open',
            draft: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

    await expect(service.getPlanPullRequestContext({ issueId: 101, workspaceId: 'workspace-1' })).resolves.toEqual({
      pullRequest: {
        number: 22,
        url: 'https://github.com/harness-kanban/payments-api/pull/22',
        title: 'Plan issue #101: Keep the rollout tiny',
        body: 'Create the technical plan file for issue 101.',
        baseBranch: 'main',
        headBranch: 'issue-101-plan',
        state: 'open',
        isDraft: true,
      },
      reviews: [],
      reviewComments: [],
      issueComments: [],
    })
  })

  it('creates a ready-for-review pull request using the AI-authored title and body', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 24,
          html_url: 'https://github.com/harness-kanban/payments-api/pull/24',
        }),
      })

    await expect(
      service.ensureReadyForReviewPullRequest({
        issueId: 101,
        workspaceId: 'workspace-1',
        branchName: 'code-bot/issue-101',
        pullRequestTitle: 'feat(worker): implement planning workflow',
        pullRequestBody: '## Summary\n- implement the approved workflow',
      }),
    ).resolves.toEqual({
      number: 24,
      url: 'https://github.com/harness-kanban/payments-api/pull/24',
    })

    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'feat(worker): implement planning workflow',
          head: 'code-bot/issue-101',
          base: 'main',
          body: '## Summary\n- implement the approved workflow',
          draft: false,
        }),
      }),
    )
  })

  it('updates an existing draft implementation pull request before marking it ready for review', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            number: 25,
            html_url: 'https://github.com/harness-kanban/payments-api/pull/25',
            draft: true,
            head: { ref: 'code-bot/issue-101' },
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 25,
          html_url: 'https://github.com/harness-kanban/payments-api/pull/25',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 25,
          html_url: 'https://github.com/harness-kanban/payments-api/pull/25',
        }),
      })

    await expect(
      service.ensureReadyForReviewPullRequest({
        issueId: 101,
        workspaceId: 'workspace-1',
        branchName: 'code-bot/issue-101',
        pullRequestTitle: 'feat(worker): implement planning workflow',
        pullRequestBody: '## Summary\n- implement the approved workflow',
      }),
    ).resolves.toEqual({
      number: 25,
      url: 'https://github.com/harness-kanban/payments-api/pull/25',
    })

    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.github.com/repos/harness-kanban/payments-api/pulls/25')
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          title: 'feat(worker): implement planning workflow',
          body: '## Summary\n- implement the approved workflow',
        }),
      }),
    )
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.github.com/repos/harness-kanban/payments-api/pulls/25/ready_for_review',
    )
  })

  it('recognizes an implementation pull request by issue reference even without the default title template', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            number: 33,
            html_url: 'https://github.com/harness-kanban/payments-api/pull/33',
            title: 'Implement issue 101 workflow',
            body: 'Implementation branch for issue 101.',
            head: { ref: 'issue-101-implementation', sha: 'abc123' },
            base: { ref: 'main' },
            state: 'open',
            draft: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 33,
          html_url: 'https://github.com/harness-kanban/payments-api/pull/33',
          title: 'Implement issue 101 workflow',
          body: 'Implementation branch for issue 101.',
          head: { ref: 'issue-101-implementation', sha: 'abc123' },
          base: { ref: 'main' },
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ state: 'success', statuses: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ check_runs: [] }),
      })

    await expect(
      service.getImplementationPullRequestContext({ issueId: 101, workspaceId: 'workspace-1' }),
    ).resolves.toEqual({
      checksEnabled: true,
      combinedStatus: {
        state: 'success',
        statuses: [],
      },
      checkRuns: [],
      pullRequest: {
        number: 33,
        url: 'https://github.com/harness-kanban/payments-api/pull/33',
        title: 'Implement issue 101 workflow',
        body: 'Implementation branch for issue 101.',
        baseBranch: 'main',
        headBranch: 'issue-101-implementation',
        headSha: 'abc123',
        state: 'open',
        isDraft: false,
        mergeable: true,
        mergeableState: 'clean',
      },
      reviews: [],
      reviewComments: [],
      issueComments: [],
    })
  })
})
