import { useApiServerClient } from '@/hooks/use-api-server'
import { DEFAULT_WORKSPACE_ID } from '@repo/shared/constants'
import { Operation } from '@repo/shared/property/types'
import { QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'

const invalidateIssueQueries = (queryClient: QueryClient, orgId: string, issueId: number) => {
  void queryClient.invalidateQueries({ queryKey: ['api-server', 'issue', issueId] })
  void queryClient.invalidateQueries({ queryKey: ['api-server', 'issueActivities', issueId] })
  void queryClient.invalidateQueries({ queryKey: ['api-server', 'issueComments', issueId] })
  void queryClient.invalidateQueries({
    queryKey: ['api-server', 'issues', orgId],
  })
  void queryClient.invalidateQueries({
    queryKey: ['api-server', 'issues-infinite', orgId],
  })
}

interface UpdateIssueMutationInput {
  issueId: number
  operations: Operation[]
}

interface UseUpdateIssueResult {
  updateIssue: (input: { operations: Operation[] }) => Promise<null>
  error: Error | null
  isMutating: boolean
}

export const useUpdateIssueMutation = () => {
  const apiClient = useApiServerClient()
  const queryClient = useQueryClient()
  const orgId = DEFAULT_WORKSPACE_ID

  const mutation = useMutation({
    mutationFn: async ({ issueId, operations }: UpdateIssueMutationInput) => {
      if (!apiClient) {
        throw new Error('API client not available')
      }

      const response = await apiClient.put<null>(`/api/v1/issues/${issueId}`, {
        operations,
      })

      if (!response.success) {
        throw new Error(response.error.message)
      }

      return response.data
    },
    onSuccess: (_, variables) => {
      invalidateIssueQueries(queryClient, orgId, variables.issueId)
    },
  })

  return {
    updateIssue: mutation.mutateAsync,
    error: mutation.error,
    isMutating: mutation.isPending,
  }
}

export const useUpdateIssue = (issueId: number): UseUpdateIssueResult => {
  const mutation = useUpdateIssueMutation()

  return {
    updateIssue: ({ operations }: { operations: Operation[] }) => mutation.updateIssue({ issueId, operations }),
    error: mutation.error,
    isMutating: mutation.isMutating,
  }
}
