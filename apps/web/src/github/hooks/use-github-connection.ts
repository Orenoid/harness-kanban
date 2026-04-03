import { useApiServerClient } from '@/hooks/use-api-server'
import {
  DeleteGithubConnectionResponseDto,
  GetGithubConnectionResponseDto,
  UpdateGithubConnectionInput,
  UpdateGithubConnectionResponseDto,
} from '@repo/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export const githubConnectionQueryKey = ['api-server', 'github', 'connection'] as const
export const githubRepositoriesQueryKey = ['api-server', 'github', 'repositories'] as const

export const useGithubConnection = (enabled = true) => {
  const apiClient = useApiServerClient()

  return useQuery({
    queryKey: githubConnectionQueryKey,
    queryFn: async () => {
      if (!apiClient) {
        throw new Error('API client not available')
      }

      const response = await apiClient.get<GetGithubConnectionResponseDto>('/api/v1/github/connection')
      if (!response.success) {
        throw new Error(response.error.message)
      }

      return response.data.connection
    },
    enabled: enabled && !!apiClient,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}

export const useUpdateGithubConnection = () => {
  const apiClient = useApiServerClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: UpdateGithubConnectionInput) => {
      if (!apiClient) {
        throw new Error('API client not available')
      }

      const response = await apiClient.put<UpdateGithubConnectionResponseDto>('/api/v1/github/connection', input)
      if (!response.success) {
        throw new Error(response.error.message)
      }

      return response.data.connection
    },
    onSuccess: async connection => {
      queryClient.setQueryData(githubConnectionQueryKey, connection)
      await queryClient.invalidateQueries({ queryKey: githubRepositoriesQueryKey })
    },
  })
}

export const useDeleteGithubConnection = () => {
  const apiClient = useApiServerClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!apiClient) {
        throw new Error('API client not available')
      }

      const response = await apiClient.delete<DeleteGithubConnectionResponseDto>('/api/v1/github/connection')
      if (!response.success) {
        throw new Error(response.error.message)
      }

      return response.data.connection
    },
    onSuccess: async connection => {
      queryClient.setQueryData(githubConnectionQueryKey, connection)
      queryClient.removeQueries({ queryKey: githubRepositoriesQueryKey })
      await queryClient.invalidateQueries({ queryKey: githubRepositoriesQueryKey })
    },
  })
}
