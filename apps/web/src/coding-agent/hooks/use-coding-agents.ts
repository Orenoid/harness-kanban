import { useApiServerClient } from '@/hooks/use-api-server'
import {
  CreateCodingAgentManagementInput,
  CreateCodingAgentResponseDto,
  GetCodingAgentsResponseDto,
  UpdateCodingAgentManagementInput,
  UpdateCodingAgentResponseDto,
} from '@repo/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export const codingAgentsQueryKey = ['api-server', 'coding-agents'] as const

export const useCodingAgents = () => {
  const apiClient = useApiServerClient()

  return useQuery({
    queryKey: codingAgentsQueryKey,
    queryFn: async () => {
      if (!apiClient) {
        throw new Error('API client not available')
      }

      const response = await apiClient.get<GetCodingAgentsResponseDto>('/api/v1/coding-agents')
      if (!response.success) {
        throw new Error(response.error.message)
      }

      return response.data.codingAgents
    },
    enabled: !!apiClient,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  })
}

export const useCreateCodingAgent = () => {
  const apiClient = useApiServerClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (codingAgent: CreateCodingAgentManagementInput) => {
      if (!apiClient) {
        throw new Error('API client not available')
      }

      const response = await apiClient.post<CreateCodingAgentResponseDto>('/api/v1/coding-agents', { codingAgent })
      if (!response.success) {
        throw new Error(response.error.message)
      }

      return response.data.codingAgent
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: codingAgentsQueryKey })
    },
  })
}

export const useUpdateCodingAgent = () => {
  const apiClient = useApiServerClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      codingAgent,
      codingAgentId,
    }: {
      codingAgentId: string
      codingAgent: UpdateCodingAgentManagementInput
    }) => {
      if (!apiClient) {
        throw new Error('API client not available')
      }

      const response = await apiClient.put<UpdateCodingAgentResponseDto>(`/api/v1/coding-agents/${codingAgentId}`, {
        codingAgent,
      })
      if (!response.success) {
        throw new Error(response.error.message)
      }

      return response.data.codingAgent
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: codingAgentsQueryKey })
    },
  })
}

export const useDeleteCodingAgent = () => {
  const apiClient = useApiServerClient()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (codingAgentId: string) => {
      if (!apiClient) {
        throw new Error('API client not available')
      }

      const response = await apiClient.delete<null>(`/api/v1/coding-agents/${codingAgentId}`)
      if (!response.success) {
        throw new Error(response.error.message)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: codingAgentsQueryKey })
    },
  })
}
