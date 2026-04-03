import { setTimeout as sleep } from 'node:timers/promises'

import { PrismaService } from '@/database/prisma.service'
import { GithubService } from '@/github/github.service'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@repo/database'
import { parseGithubRepoReference } from '@repo/shared'
import { SystemPropertyId } from '@repo/shared/property/constants'

type IssueProjectRepository = {
  checkCiCd: boolean
  githubRepoUrl: string
  repoBaseBranch: string
}

type EnsureDraftPullRequestInput = {
  branchName: string
  issueId: number
  pullRequestBody: string
  pullRequestTitle: string
  workspaceId: string
}

type EnsurePullRequestInput = {
  branchName: string
  issueId: number
  pullRequestBody: string
  pullRequestTitle: string
  workspaceId: string
}

type EnsurePullRequestResult = {
  number: number
  url: string
}

type PersistedPullRequestReference = {
  headBranch: string | null
  number: number
  url: string
}

type GithubPullRequest = {
  base?: {
    ref?: string
  }
  body?: string | null
  draft: boolean
  head?: {
    ref?: string
    sha?: string
  }
  html_url?: string
  mergeable?: boolean | null
  mergeable_state?: string | null
  number?: number
  state?: string
  title?: string
}

type GithubPullRequestReview = {
  body?: string | null
  html_url?: string
  id?: number
  state?: string
  submitted_at?: string | null
  user?: {
    login?: string
  }
}

type GithubPullRequestReviewComment = {
  body?: string | null
  created_at?: string | null
  html_url?: string
  id?: number
  line?: number | null
  path?: string | null
  side?: string | null
  updated_at?: string | null
  user?: {
    login?: string
  }
}

type GithubIssueComment = {
  body?: string | null
  created_at?: string | null
  html_url?: string
  id?: number
  updated_at?: string | null
  user?: {
    login?: string
  }
}

type GithubCombinedStatus = {
  state?: string
  statuses?: GithubCommitStatus[]
}

type GithubCommitStatus = {
  context?: string
  description?: string | null
  state?: string
  target_url?: string | null
}

type GithubCheckRunsResponse = {
  check_runs?: GithubCheckRun[]
}

type GithubCheckRun = {
  conclusion?: string | null
  details_url?: string | null
  html_url?: string | null
  id?: number
  name?: string
  status?: string
}

type PullRequestDiscussionContext = {
  issueComments: Array<{
    body: string
    createdAt: string | null
    id: number
    updatedAt: string | null
    url: string | null
    userLogin: string | null
  }>
  reviewComments: Array<{
    body: string
    createdAt: string | null
    id: number
    line: number | null
    path: string | null
    side: string | null
    updatedAt: string | null
    url: string | null
    userLogin: string | null
  }>
  reviews: Array<{
    body: string | null
    id: number
    state: string | null
    submittedAt: string | null
    url: string | null
    userLogin: string | null
  }>
}

export type PlanPullRequestContext = PullRequestDiscussionContext & {
  pullRequest: {
    baseBranch: string | null
    body: string | null
    headBranch: string | null
    isDraft: boolean
    number: number
    state: string | null
    title: string | null
    url: string
  }
}

export type ImplementationPullRequestContext = PullRequestDiscussionContext & {
  checksEnabled: boolean
  combinedStatus: {
    state: string | null
    statuses: Array<{
      context: string | null
      description: string | null
      state: string | null
      targetUrl: string | null
    }>
  }
  checkRuns: Array<{
    conclusion: string | null
    id: number
    name: string | null
    status: string | null
    url: string | null
  }>
  pullRequest: {
    baseBranch: string | null
    body: string | null
    headBranch: string | null
    headSha: string | null
    isDraft: boolean
    mergeable: boolean | null
    mergeableState: string | null
    number: number
    state: string | null
    title: string | null
    url: string
  }
}

export type ImplementationPullRequestReadiness = {
  blockingReasons: string[]
  context: ImplementationPullRequestContext
  state: 'ready' | 'failed_checks' | 'merge_conflicts'
  summary: string
}

const DEFAULT_GITHUB_API_TIMEOUT_MS = 30_000
const DEFAULT_GITHUB_READINESS_POLL_INTERVAL_MS = 15_000
const DEFAULT_GITHUB_READINESS_TIMEOUT_MS = 30 * 60 * 1000

@Injectable()
export class HarnessWorkerGithubService {
  private readonly logger = new Logger(HarnessWorkerGithubService.name)
  private readonly readinessPollIntervalMs: number
  private readonly readinessTimeoutMs: number

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly githubService: GithubService,
  ) {
    this.readinessPollIntervalMs = this.getPositiveInteger(
      'HARNESS_WORKER_GITHUB_READINESS_POLL_INTERVAL_MS',
      DEFAULT_GITHUB_READINESS_POLL_INTERVAL_MS,
    )
    this.readinessTimeoutMs = this.getPositiveInteger(
      'HARNESS_WORKER_GITHUB_READINESS_TIMEOUT_MS',
      DEFAULT_GITHUB_READINESS_TIMEOUT_MS,
    )
  }

  async ensureDraftPullRequest(input: EnsureDraftPullRequestInput): Promise<EnsurePullRequestResult> {
    const repository = await this.getIssueProjectRepository(input.issueId, input.workspaceId)
    if (!repository) {
      throw new Error(`Project repository configuration is missing for issue ${input.issueId}`)
    }

    const reference = parseGithubRepoReference(repository.githubRepoUrl)
    if (!reference) {
      throw new Error(`Unsupported GitHub repository URL: ${repository.githubRepoUrl}`)
    }

    const githubToken = await this.githubService.getTokenForWorkspace(input.workspaceId)
    const existingPullRequest = await this.findOpenPullRequestByBranch(
      githubToken,
      reference.owner,
      reference.repo,
      input.branchName,
    )
    if (existingPullRequest?.html_url && typeof existingPullRequest.number === 'number') {
      await this.updatePullRequestMetadata(
        githubToken,
        reference.owner,
        reference.repo,
        existingPullRequest.number,
        input,
      )
      const result = {
        number: existingPullRequest.number,
        url: existingPullRequest.html_url,
      }
      await this.persistPullRequestReference(input.issueId, 'plan', {
        headBranch: existingPullRequest.head?.ref?.trim() || input.branchName,
        number: result.number,
        url: result.url,
      })
      return result
    }

    const result = await this.createDraftPullRequest(
      githubToken,
      reference.owner,
      reference.repo,
      repository.repoBaseBranch,
      input,
    )
    await this.persistPullRequestReference(input.issueId, 'plan', {
      headBranch: input.branchName,
      number: result.number,
      url: result.url,
    })
    return result
  }

  async ensureReadyForReviewPullRequest(input: EnsurePullRequestInput): Promise<EnsurePullRequestResult> {
    const repository = await this.getIssueProjectRepository(input.issueId, input.workspaceId)
    if (!repository) {
      throw new Error(`Project repository configuration is missing for issue ${input.issueId}`)
    }

    const reference = parseGithubRepoReference(repository.githubRepoUrl)
    if (!reference) {
      throw new Error(`Unsupported GitHub repository URL: ${repository.githubRepoUrl}`)
    }

    const githubToken = await this.githubService.getTokenForWorkspace(input.workspaceId)
    const existingPullRequest = await this.findOpenPullRequestByBranch(
      githubToken,
      reference.owner,
      reference.repo,
      input.branchName,
    )
    if (existingPullRequest?.html_url && typeof existingPullRequest.number === 'number') {
      if (existingPullRequest.draft) {
        await this.updatePullRequestMetadata(
          githubToken,
          reference.owner,
          reference.repo,
          existingPullRequest.number,
          input,
        )
        const result = await this.markPullRequestReadyForReview(
          githubToken,
          reference.owner,
          reference.repo,
          existingPullRequest.number,
          input,
        )
        await this.persistPullRequestReference(input.issueId, 'implementation', {
          headBranch: existingPullRequest.head?.ref?.trim() || input.branchName,
          number: result.number,
          url: result.url,
        })
        return result
      }

      const result = {
        number: existingPullRequest.number,
        url: existingPullRequest.html_url,
      }
      await this.updatePullRequestMetadata(
        githubToken,
        reference.owner,
        reference.repo,
        existingPullRequest.number,
        input,
      )
      await this.persistPullRequestReference(input.issueId, 'implementation', {
        headBranch: existingPullRequest.head?.ref?.trim() || input.branchName,
        number: result.number,
        url: result.url,
      })
      return result
    }

    const result = await this.createReadyForReviewPullRequest(
      githubToken,
      reference.owner,
      reference.repo,
      repository.repoBaseBranch,
      input,
    )
    await this.persistPullRequestReference(input.issueId, 'implementation', {
      headBranch: input.branchName,
      number: result.number,
      url: result.url,
    })
    return result
  }

  async getPlanPullRequestContext(input: { issueId: number; workspaceId: string }): Promise<PlanPullRequestContext> {
    const repository = await this.getIssueProjectRepository(input.issueId, input.workspaceId)
    if (!repository) {
      throw new Error(`Project repository configuration is missing for issue ${input.issueId}`)
    }

    const reference = parseGithubRepoReference(repository.githubRepoUrl)
    if (!reference) {
      throw new Error(`Unsupported GitHub repository URL: ${repository.githubRepoUrl}`)
    }

    const githubToken = await this.githubService.getTokenForWorkspace(input.workspaceId)
    const persistedPlanPullRequest = await this.loadPersistedPullRequestReference(input.issueId, 'plan')
    const pullRequest =
      (await this.loadPullRequestByReference(githubToken, reference.owner, reference.repo, persistedPlanPullRequest)) ??
      (await this.findPlanPullRequest(githubToken, reference.owner, reference.repo, input.issueId))
    if (!pullRequest?.html_url || typeof pullRequest.number !== 'number') {
      throw new Error(`Could not find the technical plan pull request for issue ${input.issueId}`)
    }

    await this.persistPullRequestReference(input.issueId, 'plan', {
      headBranch: pullRequest.head?.ref?.trim() || persistedPlanPullRequest?.headBranch || null,
      number: pullRequest.number,
      url: pullRequest.html_url,
    })

    const discussions = await this.loadPullRequestDiscussions(
      githubToken,
      reference.owner,
      reference.repo,
      pullRequest.number,
    )

    return {
      pullRequest: {
        number: pullRequest.number,
        url: pullRequest.html_url,
        title: pullRequest.title?.trim() || null,
        body: pullRequest.body?.trim() || null,
        baseBranch: pullRequest.base?.ref?.trim() || null,
        headBranch: pullRequest.head?.ref?.trim() || null,
        state: pullRequest.state?.trim() || null,
        isDraft: pullRequest.draft,
      },
      ...discussions,
    }
  }

  async findImplementationPullRequestContext(input: {
    branchName?: string | null
    issueId: number
    workspaceId: string
  }): Promise<ImplementationPullRequestContext | null> {
    return this.loadImplementationPullRequestContext(input, false)
  }

  async getImplementationPullRequestContext(input: {
    branchName?: string | null
    issueId: number
    workspaceId: string
  }): Promise<ImplementationPullRequestContext> {
    const context = await this.loadImplementationPullRequestContext(input, true)
    if (!context) {
      throw new Error(`Could not find the implementation pull request for issue ${input.issueId}`)
    }

    return context
  }

  async waitForImplementationPullRequestReadiness(input: {
    branchName?: string | null
    issueId: number
    workspaceId: string
  }): Promise<ImplementationPullRequestReadiness> {
    const deadline = Date.now() + this.readinessTimeoutMs

    while (true) {
      const context = await this.getImplementationPullRequestContext(input)
      const readiness = this.evaluateImplementationPullRequestReadiness(context)

      if (readiness.state !== 'ready' && readiness.summary.startsWith('Pending')) {
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for pull request readiness for issue ${input.issueId}`)
        }

        this.logger.log(
          `Waiting for pull request readiness for issue ${input.issueId}: ${readiness.summary.toLowerCase()}`,
        )
        await sleep(this.readinessPollIntervalMs)
        continue
      }

      return readiness.state === 'ready'
        ? readiness
        : {
            ...readiness,
            summary: readiness.summary,
          }
    }
  }

  private async loadImplementationPullRequestContext(
    input: {
      branchName?: string | null
      issueId: number
      workspaceId: string
    },
    required: boolean,
  ): Promise<ImplementationPullRequestContext | null> {
    const repository = await this.getIssueProjectRepository(input.issueId, input.workspaceId)
    if (!repository) {
      throw new Error(`Project repository configuration is missing for issue ${input.issueId}`)
    }

    const reference = parseGithubRepoReference(repository.githubRepoUrl)
    if (!reference) {
      throw new Error(`Unsupported GitHub repository URL: ${repository.githubRepoUrl}`)
    }

    const githubToken = await this.githubService.getTokenForWorkspace(input.workspaceId)
    const persistedImplementationPullRequest = input.branchName?.trim()
      ? null
      : await this.loadPersistedPullRequestReference(input.issueId, 'implementation')
    const pullRequest = input.branchName?.trim()
      ? await this.findOpenPullRequestByBranch(githubToken, reference.owner, reference.repo, input.branchName.trim())
      : ((await this.loadPullRequestByReference(
          githubToken,
          reference.owner,
          reference.repo,
          persistedImplementationPullRequest,
        )) ?? (await this.findImplementationPullRequest(githubToken, reference.owner, reference.repo, input.issueId)))

    if (!pullRequest?.html_url || typeof pullRequest.number !== 'number') {
      if (required) {
        throw new Error(`Could not find the implementation pull request for issue ${input.issueId}`)
      }

      return null
    }

    await this.persistPullRequestReference(input.issueId, 'implementation', {
      headBranch:
        pullRequest.head?.ref?.trim() ||
        input.branchName?.trim() ||
        persistedImplementationPullRequest?.headBranch ||
        null,
      number: pullRequest.number,
      url: pullRequest.html_url,
    })

    const [pullRequestDetail, discussions, combinedStatus, checkRuns] = await Promise.all([
      this.githubRequest<GithubPullRequest>(
        githubToken,
        `https://api.github.com/repos/${reference.owner}/${reference.repo}/pulls/${pullRequest.number}`,
        { method: 'GET' },
      ),
      this.loadPullRequestDiscussions(githubToken, reference.owner, reference.repo, pullRequest.number),
      this.loadCombinedStatus(githubToken, reference.owner, reference.repo, pullRequest.head?.sha),
      this.loadCheckRuns(githubToken, reference.owner, reference.repo, pullRequest.head?.sha),
    ])

    if (!pullRequestDetail.html_url || typeof pullRequestDetail.number !== 'number') {
      throw new Error(`GitHub did not return full pull request details for issue ${input.issueId}`)
    }

    return {
      checksEnabled: repository.checkCiCd,
      combinedStatus: {
        state: combinedStatus?.state?.trim() || null,
        statuses: (combinedStatus?.statuses ?? []).map(status => ({
          context: status.context?.trim() || null,
          description: status.description?.trim() || null,
          state: status.state?.trim() || null,
          targetUrl: status.target_url?.trim() || null,
        })),
      },
      checkRuns: (checkRuns?.check_runs ?? [])
        .filter((checkRun): checkRun is GithubCheckRun & { id: number } => typeof checkRun.id === 'number')
        .map(checkRun => ({
          id: checkRun.id,
          name: checkRun.name?.trim() || null,
          status: checkRun.status?.trim() || null,
          conclusion: checkRun.conclusion?.trim() || null,
          url: checkRun.html_url?.trim() || checkRun.details_url?.trim() || null,
        })),
      pullRequest: {
        number: pullRequestDetail.number,
        url: pullRequestDetail.html_url,
        title: pullRequestDetail.title?.trim() || null,
        body: pullRequestDetail.body?.trim() || null,
        baseBranch: pullRequestDetail.base?.ref?.trim() || null,
        headBranch: pullRequestDetail.head?.ref?.trim() || null,
        headSha: pullRequestDetail.head?.sha?.trim() || null,
        state: pullRequestDetail.state?.trim() || null,
        isDraft: pullRequestDetail.draft,
        mergeable: typeof pullRequestDetail.mergeable === 'boolean' ? pullRequestDetail.mergeable : null,
        mergeableState: pullRequestDetail.mergeable_state?.trim() || null,
      },
      ...discussions,
    }
  }

  private evaluateImplementationPullRequestReadiness(
    context: ImplementationPullRequestContext,
  ): ImplementationPullRequestReadiness | (ImplementationPullRequestReadiness & { summary: `Pending${string}` }) {
    const mergeableState = context.pullRequest.mergeableState ?? 'unknown'
    const mergeable = context.pullRequest.mergeable

    if (mergeable === null || mergeableState === 'unknown') {
      return {
        state: 'failed_checks',
        blockingReasons: [],
        context,
        summary: 'Pending mergeability computation from GitHub.',
      }
    }

    if (mergeable === false || mergeableState === 'dirty') {
      return {
        state: 'merge_conflicts',
        blockingReasons: [
          `Pull request mergeability is blocked (mergeable=${String(mergeable)}, mergeable_state=${mergeableState}).`,
        ],
        context,
        summary: 'Pull request has merge conflicts or is not mergeable.',
      }
    }

    const failedStatuses = context.combinedStatus.statuses.filter(status =>
      ['error', 'failure'].includes((status.state ?? '').toLowerCase()),
    )
    const pendingStatuses = context.combinedStatus.statuses.filter(status =>
      ['pending'].includes((status.state ?? '').toLowerCase()),
    )
    const failedCheckRuns = context.checkRuns.filter(checkRun => {
      const conclusion = (checkRun.conclusion ?? '').toLowerCase()
      return ['action_required', 'cancelled', 'failure', 'neutral', 'startup_failure', 'timed_out'].includes(conclusion)
    })
    const pendingCheckRuns = context.checkRuns.filter(checkRun => {
      const status = (checkRun.status ?? '').toLowerCase()
      return status.length > 0 && status !== 'completed'
    })

    if (context.checksEnabled) {
      if (pendingStatuses.length > 0 || pendingCheckRuns.length > 0) {
        return {
          state: 'failed_checks',
          blockingReasons: [],
          context,
          summary: 'Pending CI/CD checks are still running.',
        }
      }

      if (failedStatuses.length > 0 || failedCheckRuns.length > 0) {
        return {
          state: 'failed_checks',
          blockingReasons: [
            ...failedStatuses.map(status => this.describeCommitStatus(status)),
            ...failedCheckRuns.map(checkRun => this.describeCheckRun(checkRun)),
          ],
          context,
          summary: 'Pull request has failing CI/CD checks.',
        }
      }
    }

    return {
      state: 'ready',
      blockingReasons: [],
      context,
      summary: 'Pull request is ready for human review.',
    }
  }

  private describeCommitStatus(status: {
    context: string | null
    description: string | null
    state: string | null
    targetUrl: string | null
  }): string {
    return [
      `Status ${status.context ?? '(unknown)'}`,
      `state=${status.state ?? 'unknown'}`,
      status.description ? `description=${status.description}` : null,
      status.targetUrl ? `url=${status.targetUrl}` : null,
    ]
      .filter(Boolean)
      .join(', ')
  }

  private describeCheckRun(checkRun: {
    conclusion: string | null
    name: string | null
    status: string | null
    url: string | null
  }): string {
    return [
      `Check run ${checkRun.name ?? '(unknown)'}`,
      `status=${checkRun.status ?? 'unknown'}`,
      `conclusion=${checkRun.conclusion ?? 'unknown'}`,
      checkRun.url ? `url=${checkRun.url}` : null,
    ]
      .filter(Boolean)
      .join(', ')
  }

  private async loadPullRequestDiscussions(
    githubToken: string,
    owner: string,
    repo: string,
    pullRequestNumber: number,
  ): Promise<PullRequestDiscussionContext> {
    const [reviews, reviewComments, issueComments] = await Promise.all([
      this.githubRequest<GithubPullRequestReview[]>(
        githubToken,
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pullRequestNumber}/reviews?per_page=100`,
        { method: 'GET' },
      ),
      this.githubRequest<GithubPullRequestReviewComment[]>(
        githubToken,
        `https://api.github.com/repos/${owner}/${repo}/pulls/${pullRequestNumber}/comments?per_page=100`,
        { method: 'GET' },
      ),
      this.githubRequest<GithubIssueComment[]>(
        githubToken,
        `https://api.github.com/repos/${owner}/${repo}/issues/${pullRequestNumber}/comments?per_page=100`,
        { method: 'GET' },
      ),
    ])

    return {
      reviews: reviews
        .filter((review): review is GithubPullRequestReview & { id: number } => typeof review.id === 'number')
        .map(review => ({
          id: review.id,
          state: review.state?.trim() || null,
          body: review.body?.trim() || null,
          submittedAt: review.submitted_at?.trim() || null,
          url: review.html_url?.trim() || null,
          userLogin: review.user?.login?.trim() || null,
        })),
      reviewComments: reviewComments
        .filter(
          (comment): comment is GithubPullRequestReviewComment & { body: string; id: number } =>
            typeof comment.id === 'number' && typeof comment.body === 'string' && comment.body.trim().length > 0,
        )
        .map(comment => ({
          id: comment.id,
          body: comment.body.trim(),
          path: comment.path?.trim() || null,
          line: typeof comment.line === 'number' ? comment.line : null,
          side: comment.side?.trim() || null,
          createdAt: comment.created_at?.trim() || null,
          updatedAt: comment.updated_at?.trim() || null,
          url: comment.html_url?.trim() || null,
          userLogin: comment.user?.login?.trim() || null,
        })),
      issueComments: issueComments
        .filter(
          (comment): comment is GithubIssueComment & { body: string; id: number } =>
            typeof comment.id === 'number' && typeof comment.body === 'string' && comment.body.trim().length > 0,
        )
        .map(comment => ({
          id: comment.id,
          body: comment.body.trim(),
          createdAt: comment.created_at?.trim() || null,
          updatedAt: comment.updated_at?.trim() || null,
          url: comment.html_url?.trim() || null,
          userLogin: comment.user?.login?.trim() || null,
        })),
    }
  }

  private async loadCombinedStatus(
    githubToken: string,
    owner: string,
    repo: string,
    headSha: string | undefined,
  ): Promise<GithubCombinedStatus | null> {
    const normalizedSha = headSha?.trim()
    if (!normalizedSha) {
      return null
    }

    return this.githubRequest<GithubCombinedStatus>(
      githubToken,
      `https://api.github.com/repos/${owner}/${repo}/commits/${normalizedSha}/status`,
      { method: 'GET' },
    )
  }

  private async loadCheckRuns(
    githubToken: string,
    owner: string,
    repo: string,
    headSha: string | undefined,
  ): Promise<GithubCheckRunsResponse | null> {
    const normalizedSha = headSha?.trim()
    if (!normalizedSha) {
      return null
    }

    return this.githubRequest<GithubCheckRunsResponse>(
      githubToken,
      `https://api.github.com/repos/${owner}/${repo}/commits/${normalizedSha}/check-runs?per_page=100`,
      { method: 'GET' },
    )
  }

  private async getIssueProjectRepository(
    issueId: number,
    workspaceId: string,
  ): Promise<IssueProjectRepository | null> {
    const projectBinding = await this.prisma.client.property_single_value.findFirst({
      where: {
        issue_id: issueId,
        property_id: SystemPropertyId.PROJECT,
        deleted_at: null,
        value: { not: null },
      },
      select: {
        value: true,
      },
    })

    const projectId = projectBinding?.value?.trim()
    if (!projectId) {
      return null
    }

    const project = await this.prisma.client.project.findFirst({
      where: {
        id: projectId,
        workspace_id: workspaceId,
        deleted_at: null,
      },
      select: {
        check_ci_cd: true,
        github_repo_url: true,
        repo_base_branch: true,
      },
    })

    if (!project) {
      return null
    }

    return {
      checkCiCd: project.check_ci_cd,
      githubRepoUrl: project.github_repo_url,
      repoBaseBranch: project.repo_base_branch,
    }
  }

  private async findOpenPullRequestByBranch(
    githubToken: string,
    owner: string,
    repo: string,
    branchName: string,
  ): Promise<GithubPullRequest | null> {
    const head = `${owner}:${branchName}`
    const pullRequests = await this.githubRequest<GithubPullRequest[]>(
      githubToken,
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(head)}`,
      {
        method: 'GET',
      },
    )

    return pullRequests.find(candidate => candidate.head?.ref === branchName) ?? pullRequests[0] ?? null
  }

  private async loadPullRequestByReference(
    githubToken: string,
    owner: string,
    repo: string,
    reference: PersistedPullRequestReference | null,
  ): Promise<GithubPullRequest | null> {
    if (!reference) {
      return null
    }

    try {
      return await this.githubRequest<GithubPullRequest>(
        githubToken,
        `https://api.github.com/repos/${owner}/${repo}/pulls/${reference.number}`,
        {
          method: 'GET',
        },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(
        `Failed to load persisted pull request #${reference.number}; falling back to discovery. Reason: ${message}`,
      )
      return null
    }
  }

  private async findPlanPullRequest(
    githubToken: string,
    owner: string,
    repo: string,
    issueId: number,
  ): Promise<GithubPullRequest | null> {
    const pullRequests = await this.githubRequest<GithubPullRequest[]>(
      githubToken,
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
      {
        method: 'GET',
      },
    )

    return pullRequests.find(pullRequest => this.isPlanPullRequestCandidate(pullRequest, issueId)) ?? null
  }

  private async findImplementationPullRequest(
    githubToken: string,
    owner: string,
    repo: string,
    issueId: number,
  ): Promise<GithubPullRequest | null> {
    const pullRequests = await this.githubRequest<GithubPullRequest[]>(
      githubToken,
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`,
      {
        method: 'GET',
      },
    )

    return pullRequests.find(pullRequest => this.isImplementationPullRequestCandidate(pullRequest, issueId)) ?? null
  }

  private isPlanPullRequestCandidate(pullRequest: GithubPullRequest, issueId: number): boolean {
    const title = pullRequest.title?.trim() ?? ''
    const body = pullRequest.body?.trim() ?? ''
    const normalizedText = `${title}\n${body}`.toLowerCase()

    if (title.startsWith(`Technical plan for issue #${issueId}:`)) {
      return true
    }

    if (!this.matchesIssueReference(normalizedText, issueId)) {
      return false
    }

    if (normalizedText.includes('technical plan') || normalizedText.includes('plan issue')) {
      return true
    }

    return pullRequest.draft && /\bplan\b/i.test(normalizedText)
  }

  private isImplementationPullRequestCandidate(pullRequest: GithubPullRequest, issueId: number): boolean {
    const title = pullRequest.title?.trim() ?? ''
    const body = pullRequest.body?.trim() ?? ''
    const normalizedText = `${title}\n${body}`.toLowerCase()

    if (title.startsWith(`Issue #${issueId}:`)) {
      return true
    }

    return this.matchesIssueReference(normalizedText, issueId) && !normalizedText.includes('technical plan')
  }

  private matchesIssueReference(value: string, issueId: number): boolean {
    const escapedIssueId = String(issueId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const issuePatterns = [
      new RegExp(`\\bissue\\s*#?\\s*${escapedIssueId}\\b`, 'i'),
      new RegExp(`#${escapedIssueId}\\b`, 'i'),
    ]

    return issuePatterns.some(pattern => pattern.test(value))
  }

  private async createDraftPullRequest(
    githubToken: string,
    owner: string,
    repo: string,
    baseBranch: string,
    input: EnsureDraftPullRequestInput,
  ): Promise<EnsurePullRequestResult> {
    const pullRequest = await this.githubRequest<GithubPullRequest>(
      githubToken,
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: input.pullRequestTitle,
          head: input.branchName,
          base: baseBranch,
          body: input.pullRequestBody,
          draft: true,
        }),
      },
    )

    if (!pullRequest.html_url || typeof pullRequest.number !== 'number') {
      throw new Error(`GitHub did not return a pull request URL for issue ${input.issueId}`)
    }

    return {
      number: pullRequest.number,
      url: pullRequest.html_url,
    }
  }

  private async createReadyForReviewPullRequest(
    githubToken: string,
    owner: string,
    repo: string,
    baseBranch: string,
    input: EnsurePullRequestInput,
  ): Promise<EnsurePullRequestResult> {
    const pullRequest = await this.githubRequest<GithubPullRequest>(
      githubToken,
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: input.pullRequestTitle,
          head: input.branchName,
          base: baseBranch,
          body: input.pullRequestBody,
          draft: false,
        }),
      },
    )

    if (!pullRequest.html_url || typeof pullRequest.number !== 'number') {
      throw new Error(`GitHub did not return a pull request URL for issue ${input.issueId}`)
    }

    return {
      number: pullRequest.number,
      url: pullRequest.html_url,
    }
  }

  private async markPullRequestReadyForReview(
    githubToken: string,
    owner: string,
    repo: string,
    pullRequestNumber: number,
    input: EnsurePullRequestInput,
  ): Promise<EnsurePullRequestResult> {
    const pullRequest = await this.githubRequest<GithubPullRequest>(
      githubToken,
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pullRequestNumber}/ready_for_review`,
      {
        method: 'POST',
      },
    )

    if (!pullRequest.html_url || typeof pullRequest.number !== 'number') {
      throw new Error(`GitHub did not return a ready-for-review pull request URL for issue ${input.issueId}`)
    }

    return {
      number: pullRequest.number,
      url: pullRequest.html_url,
    }
  }

  private async updatePullRequestMetadata(
    githubToken: string,
    owner: string,
    repo: string,
    pullRequestNumber: number,
    input: { pullRequestBody: string; pullRequestTitle: string },
  ): Promise<void> {
    await this.githubRequest<GithubPullRequest>(
      githubToken,
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pullRequestNumber}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          title: input.pullRequestTitle,
          body: input.pullRequestBody,
        }),
      },
    )
  }

  private async loadPersistedPullRequestReference(
    issueId: number,
    kind: 'implementation' | 'plan',
  ): Promise<PersistedPullRequestReference | null> {
    const worker = await this.prisma.client.harness_worker.findFirst({
      where: {
        issue_id: issueId,
      },
      select: {
        devpod_metadata: true,
      },
    })

    const metadata = this.asRecord(worker?.devpod_metadata)
    const githubMetadata = this.asRecord(metadata?.github)
    const pullRequestMetadata = this.asRecord(
      kind === 'plan' ? githubMetadata?.planPullRequest : githubMetadata?.implementationPullRequest,
    )
    const number = pullRequestMetadata?.number
    const url = pullRequestMetadata?.url
    const headBranch = pullRequestMetadata?.headBranch

    if (typeof number !== 'number' || !Number.isInteger(number) || typeof url !== 'string' || url.trim().length === 0) {
      return null
    }

    return {
      headBranch: typeof headBranch === 'string' && headBranch.trim().length > 0 ? headBranch.trim() : null,
      number,
      url: url.trim(),
    }
  }

  private async persistPullRequestReference(
    issueId: number,
    kind: 'implementation' | 'plan',
    reference: PersistedPullRequestReference,
  ): Promise<void> {
    const worker = await this.prisma.client.harness_worker.findFirst({
      where: {
        issue_id: issueId,
      },
      select: {
        devpod_metadata: true,
      },
    })

    if (!worker) {
      return
    }

    const metadata = this.asRecord(worker.devpod_metadata) ?? {}
    const githubMetadata = this.asRecord(metadata.github) ?? {}
    const nextMetadata = {
      ...metadata,
      github: {
        ...githubMetadata,
        [kind === 'plan' ? 'planPullRequest' : 'implementationPullRequest']: {
          headBranch: reference.headBranch,
          number: reference.number,
          url: reference.url,
        },
      },
    }

    await this.prisma.client.harness_worker.updateMany({
      where: {
        issue_id: issueId,
      },
      data: {
        devpod_metadata: nextMetadata as Prisma.InputJsonValue,
      },
    })
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }

    return value as Record<string, unknown>
  }

  private async githubRequest<T>(token: string, url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'harness-kanban-worker',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(DEFAULT_GITHUB_API_TIMEOUT_MS),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`GitHub API request failed (${response.status}): ${errorText || response.statusText}`)
    }

    return (await response.json()) as T
  }

  private getPositiveInteger(key: string, fallback: number): number {
    const rawValue = this.configService.get<string | number | undefined>(key)
    const parsedValue =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string'
          ? Number.parseInt(rawValue.trim(), 10)
          : Number.NaN

    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback
  }
}
