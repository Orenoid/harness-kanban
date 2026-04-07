export type HarnessWorkerIssueTriggerType =
  | 'resume_planning'
  | 'approve_plan'
  | 'resume_implementation'
  | 'requested_code_changes'
  | 'release_claim'

export type HarnessWorkerIssueTrigger = {
  issueId: number
  workspaceId: string
  trigger: HarnessWorkerIssueTriggerType
  previousStatus: string
  nextStatus: string
  requestedAt: string
  requestedBy: string
}
