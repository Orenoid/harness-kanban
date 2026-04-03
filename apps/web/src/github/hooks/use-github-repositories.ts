import { useApiServerClient } from '@/hooks/use-api-server'
import { GetGithubBranchesResponseDto, GetGithubRepositoriesResponseDto } from '@repo/shared'
import { useQuery } from '@tanstack/react-query'
import { githubRepositoriesQueryKey } from './use-github-connection'

export const useGithubRepositories = (enabled = true) => {
  const apiClient = useApiServerClient()

  return useQuery({
    queryKey: githubRepositoriesQueryKey,
    queryFn: async () => {
      if (!apiClient) {
        throw new Error('API client not available')
      }

      const response = await apiClient.get<GetGithubRepositoriesResponseDto>('/api/v1/github/repositories')
      if (!response.success) {
        throw new Error(response.error.message)
      }

      return response.data.repositories
    },
    enabled: enabled && !!apiClient,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}

export const useGithubBranches = (repositoryFullName: string, enabled = true) => {
  const apiClient = useApiServerClient()
  const normalizedRepositoryFullName = repositoryFullName.trim()

  return useQuery({
    queryKey: ['api-server', 'github', 'branches', normalizedRepositoryFullName],
    queryFn: async () => {
      if (!apiClient) {
        throw new Error('API client not available')
      }

      const response = await apiClient.get<GetGithubBranchesResponseDto>(
        `/api/v1/github/branches?repository=${encodeURIComponent(normalizedRepositoryFullName)}`,
      )
      if (!response.success) {
        throw new Error(response.error.message)
      }

      return response.data.branches
    },
    enabled: enabled && Boolean(normalizedRepositoryFullName) && !!apiClient,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}
