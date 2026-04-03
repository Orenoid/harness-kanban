export interface GithubConnectionStatus {
  hasToken: boolean
  updatedAt: string | null
}

export interface GithubRepositorySummary {
  defaultBranch: string
  fullName: string
  githubRepoUrl: string
  id: number
  isPrivate: boolean
}

export interface GithubBranchSummary {
  isDefault: boolean
  name: string
}

export interface GetGithubConnectionResponseDto {
  connection: GithubConnectionStatus
}

export interface UpdateGithubConnectionInput {
  token: string
}

export interface UpdateGithubConnectionResponseDto {
  connection: GithubConnectionStatus
}

export interface DeleteGithubConnectionResponseDto {
  connection: GithubConnectionStatus
}

export interface GetGithubRepositoriesResponseDto {
  repositories: GithubRepositorySummary[]
}

export interface GetGithubBranchesResponseDto {
  branches: GithubBranchSummary[]
}
