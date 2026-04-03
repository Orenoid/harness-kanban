import { PrismaService } from '@/database/prisma.service'
import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  GithubBranchSummary,
  GithubConnectionStatus,
  GithubRepositorySummary,
  parseGithubRepoReference,
  UpdateGithubConnectionInput,
} from '@repo/shared'
import { decryptGithubToken, encryptGithubToken } from './github-token.crypto'

type GithubAuthenticatedUserResponse = {
  login?: string
}

type GithubRepositoryResponse = {
  default_branch?: string
  full_name?: string
  html_url?: string
  id?: number
  private?: boolean
}

type GithubBranchResponse = {
  name?: string
}

const GITHUB_API_BASE_URL = 'https://api.github.com'
const GITHUB_API_TIMEOUT_MS = 30_000
const GITHUB_PER_PAGE = 100

@Injectable()
export class GithubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getConnectionStatus(workspaceId: string): Promise<GithubConnectionStatus> {
    const connection = await this.prisma.client.workspace_github_connection.findUnique({
      where: { workspace_id: workspaceId },
      select: {
        github_token_encrypted: true,
        github_token_updated_at: true,
      },
    })

    return {
      hasToken: Boolean(connection?.github_token_encrypted),
      updatedAt: connection?.github_token_updated_at?.toISOString() ?? null,
    }
  }

  async updateConnection(workspaceId: string, input: UpdateGithubConnectionInput): Promise<GithubConnectionStatus> {
    const token = input.token.trim()
    if (!token) {
      throw new BadRequestException('GitHub token is required.')
    }

    await this.validateGithubToken(token)

    await this.prisma.client.workspace_github_connection.upsert({
      where: { workspace_id: workspaceId },
      create: {
        workspace_id: workspaceId,
        github_token_encrypted: this.encryptToken(token),
        github_token_updated_at: new Date(),
      },
      update: {
        github_token_encrypted: this.encryptToken(token),
        github_token_updated_at: new Date(),
      },
    })

    return this.getConnectionStatus(workspaceId)
  }

  async clearConnection(workspaceId: string): Promise<GithubConnectionStatus> {
    await this.prisma.client.workspace_github_connection.deleteMany({
      where: { workspace_id: workspaceId },
    })

    return this.getConnectionStatus(workspaceId)
  }

  async getRepositories(workspaceId: string): Promise<GithubRepositorySummary[]> {
    const token = await this.getTokenForWorkspace(workspaceId)
    const repositories: GithubRepositorySummary[] = []

    for (let page = 1; page < 100; page += 1) {
      const response = await this.githubRequest<GithubRepositoryResponse[]>(
        `${GITHUB_API_BASE_URL}/user/repos?affiliation=owner,collaborator,organization_member&per_page=${GITHUB_PER_PAGE}&page=${page}&sort=full_name`,
        token,
      )

      const pageRepositories = response
        .map(repository => this.toRepositorySummary(repository))
        .filter((repository): repository is GithubRepositorySummary => repository !== null)

      repositories.push(...pageRepositories)

      if (response.length < GITHUB_PER_PAGE) {
        break
      }
    }

    return repositories.sort((left, right) => left.fullName.localeCompare(right.fullName))
  }

  async getBranches(workspaceId: string, repository: string): Promise<GithubBranchSummary[]> {
    const normalizedRepository = repository.trim()
    const reference = parseGithubRepoReference(`https://github.com/${normalizedRepository}`)
    if (!reference) {
      throw new BadRequestException('Repository must be in the format owner/repo.')
    }

    const token = await this.getTokenForWorkspace(workspaceId)
    const repositoryMetadata = await this.githubRequest<GithubRepositoryResponse>(
      `${GITHUB_API_BASE_URL}/repos/${reference.owner}/${reference.repo}`,
      token,
    )
    const defaultBranch = repositoryMetadata.default_branch?.trim() ?? ''
    const branches: GithubBranchSummary[] = []

    for (let page = 1; page < 100; page += 1) {
      const response = await this.githubRequest<GithubBranchResponse[]>(
        `${GITHUB_API_BASE_URL}/repos/${reference.owner}/${reference.repo}/branches?per_page=${GITHUB_PER_PAGE}&page=${page}`,
        token,
      )

      branches.push(
        ...response
          .map(branch => branch.name?.trim())
          .filter((branchName): branchName is string => Boolean(branchName))
          .map(branchName => ({
            name: branchName,
            isDefault: branchName === defaultBranch,
          })),
      )

      if (response.length < GITHUB_PER_PAGE) {
        break
      }
    }

    return branches.sort((left, right) => {
      if (left.isDefault && !right.isDefault) {
        return -1
      }
      if (!left.isDefault && right.isDefault) {
        return 1
      }
      return left.name.localeCompare(right.name)
    })
  }

  private async validateGithubToken(token: string): Promise<void> {
    await this.githubRequest<GithubAuthenticatedUserResponse>(`${GITHUB_API_BASE_URL}/user`, token)
  }

  private toRepositorySummary(repository: GithubRepositoryResponse): GithubRepositorySummary | null {
    const fullName = repository.full_name?.trim()
    const githubRepoUrl = repository.html_url?.trim()
    const defaultBranch = repository.default_branch?.trim()

    if (!fullName || !githubRepoUrl || typeof repository.id !== 'number' || !defaultBranch) {
      return null
    }

    return {
      id: repository.id,
      fullName,
      githubRepoUrl,
      defaultBranch,
      isPrivate: Boolean(repository.private),
    }
  }

  async getTokenForWorkspace(workspaceId: string): Promise<string> {
    const connection = await this.prisma.client.workspace_github_connection.findUnique({
      where: { workspace_id: workspaceId },
      select: {
        github_token_encrypted: true,
      },
    })

    if (!connection?.github_token_encrypted) {
      throw new BadRequestException('GitHub token is not configured. Open Settings > Connections to add one.')
    }

    return this.decryptToken(connection.github_token_encrypted)
  }

  private encryptToken(token: string): string {
    const secret = this.configService.get<string>('BETTER_AUTH_SECRET')?.trim()
    if (!secret) {
      throw new InternalServerErrorException('BETTER_AUTH_SECRET is required to encrypt GitHub tokens.')
    }

    return encryptGithubToken(token, secret)
  }

  private decryptToken(payload: string): string {
    // TODO not supposed to use `BETTER_AUTH_SECRET`, better to have a separate secret
    const secret = this.configService.get<string>('BETTER_AUTH_SECRET')?.trim()
    if (!secret) {
      throw new InternalServerErrorException('BETTER_AUTH_SECRET is required to decrypt GitHub tokens.')
    }

    return decryptGithubToken(payload, secret)
  }

  private async githubRequest<T>(url: string, token: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'harness-kanban-web',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    })

    if (!response.ok) {
      const errorText = await response.text()

      if (response.status === 401) {
        throw new BadRequestException('GitHub token is invalid.')
      }

      if (response.status === 403) {
        throw new BadRequestException('GitHub request was denied. Check the token permissions and repository access.')
      }

      if (response.status === 404) {
        throw new BadRequestException('GitHub repository was not found or is not accessible with this token.')
      }

      throw new BadRequestException(`GitHub request failed (${response.status}): ${errorText || response.statusText}`)
    }

    return (await response.json()) as T
  }
}
