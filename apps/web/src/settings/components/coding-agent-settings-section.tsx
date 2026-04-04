'use client'

import { Bot, LoaderCircle, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import React, { useMemo, useState } from 'react'

import {
  useCodingAgents,
  useCreateCodingAgent,
  useDeleteCodingAgent,
  useUpdateCodingAgent,
} from '@/coding-agent/hooks/use-coding-agents'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/shadcn/utils'
import { CodexCodingAgentForm } from '@/settings/components/coding-agent-form'
import {
  CODING_AGENT_DEFINITIONS,
  CodingAgentManagementDetail,
  CodingAgentManagementSettings,
  ConfigurableCodingAgentType,
  CreateCodingAgentManagementInput,
  getCodingAgentDefinition,
  UpdateCodingAgentManagementInput,
} from '@repo/shared'

type SupportedCodingAgentDetail = CodingAgentManagementDetail<ConfigurableCodingAgentType>

type CodingAgentSettingsSectionViewProps = {
  codingAgents: CodingAgentManagementDetail[]
  createType: ConfigurableCodingAgentType | null
  deleteTarget: CodingAgentManagementDetail | null
  editTarget: SupportedCodingAgentDetail | null
  errorMessage: string | null
  isCreating: boolean
  isDeleting: boolean
  isLoading: boolean
  isUpdating: boolean
  onCloseCreate: () => void
  onCloseDelete: () => void
  onCloseEdit: () => void
  onConfirmDelete: () => void
  onCreate: (type: ConfigurableCodingAgentType) => void
  onCreateSubmit: (codingAgent: CreateCodingAgentManagementInput<'codex'>) => Promise<void> | void
  onDelete: (codingAgent: CodingAgentManagementDetail) => void
  onEdit: (codingAgent: SupportedCodingAgentDetail) => void
  onRetry: () => void
  onUpdateSubmit: (codingAgent: UpdateCodingAgentManagementInput<'codex'>) => Promise<void> | void
}

const isSupportedCodingAgent = (codingAgent: CodingAgentManagementDetail): codingAgent is SupportedCodingAgentDetail =>
  codingAgent.type === 'codex'

const formatCredentialStatus = (settings: CodingAgentManagementSettings): string =>
  settings.hasCredential ? 'Configured' : 'Missing'

const formatReasoningEffort = (value: string): string =>
  value === 'xhigh' ? 'XHigh' : value.charAt(0).toUpperCase() + value.slice(1)

const renderCodingAgentDetails = (codingAgent: CodingAgentManagementDetail) => {
  if (codingAgent.type === 'codex') {
    const settings = codingAgent.settings as CodingAgentManagementSettings<'codex'>

    return [
      {
        label: 'Model',
        value: settings.model,
      },
      {
        label: 'Reasoning',
        value: formatReasoningEffort(settings.reasoningEffort),
      },
      {
        label: 'Credentials',
        value: formatCredentialStatus(settings),
      },
    ]
  }

  return [
    {
      label: 'Model',
      value: codingAgent.settings.model,
    },
    {
      label: 'Credentials',
      value: formatCredentialStatus(codingAgent.settings),
    },
  ]
}

export const CodingAgentSettingsSectionView: React.FC<CodingAgentSettingsSectionViewProps> = ({
  codingAgents,
  createType,
  deleteTarget,
  editTarget,
  errorMessage,
  isCreating,
  isDeleting,
  isLoading,
  isUpdating,
  onCloseCreate,
  onCloseDelete,
  onCloseEdit,
  onConfirmDelete,
  onCreate,
  onCreateSubmit,
  onDelete,
  onEdit,
  onRetry,
  onUpdateSubmit,
}) => {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Coding Agents</h2>
        <p className="text-muted-foreground text-sm">
          Manage reusable coding agent configurations for long-running worker execution. Secrets stay hidden after they
          are saved.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {CODING_AGENT_DEFINITIONS.map(definition => {
          const isAvailable = definition.managementAvailability === 'available'

          return (
            <Card key={definition.type} className={cn(!isAvailable && 'border-dashed')}>
              <CardHeader>
                <div className="flex items-start gap-3">
                  <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
                    {definition.type === 'codex' ? <Bot className="size-5" /> : <Sparkles className="size-5" />}
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{definition.label}</CardTitle>
                      <Badge variant={isAvailable ? 'secondary' : 'outline'}>
                        {isAvailable ? 'Available now' : 'Coming soon'}
                      </Badge>
                    </div>
                    <CardDescription>{definition.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardFooter className="justify-end">
                <Button
                  type="button"
                  variant={isAvailable ? 'default' : 'outline'}
                  disabled={!isAvailable}
                  onClick={() => {
                    if (isAvailable) {
                      onCreate(definition.type)
                    }
                  }}>
                  {isAvailable ? 'Add configuration' : 'Not yet available'}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Saved configurations</h3>
            <p className="text-muted-foreground text-sm">
              Edit non-sensitive fields, rotate API keys, and mark one configuration as the default for each agent type.
            </p>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-sm">
              Loading coding agent configurations...
            </CardContent>
          </Card>
        ) : errorMessage ? (
          <Card>
            <CardContent className="space-y-4 py-8">
              <p className="text-sm text-red-500">{errorMessage}</p>
              <Button type="button" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : codingAgents.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-sm">
              No coding agent configurations yet. Add a Codex configuration above to get started.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {codingAgents.map(codingAgent => {
              const definition = getCodingAgentDefinition(codingAgent.type)
              const isEditable = isSupportedCodingAgent(codingAgent)
              const details = renderCodingAgentDetails(codingAgent)

              return (
                <Card key={codingAgent.id}>
                  <CardHeader>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>{codingAgent.name}</CardTitle>
                        <Badge variant="outline">{definition.label}</Badge>
                        {codingAgent.isDefault ? <Badge>Default</Badge> : null}
                        {definition.managementAvailability !== 'available' ? (
                          <Badge variant="secondary">Coming soon</Badge>
                        ) : null}
                      </div>
                      <CardDescription>
                        {isEditable
                          ? 'Ready for use in worker execution.'
                          : 'This agent type is stored and can still be removed, but Settings editing is not available yet.'}
                      </CardDescription>
                    </div>
                    <CardAction>
                      <div className="flex items-center gap-2">
                        {isEditable ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(codingAgent)}>
                            Edit
                          </Button>
                        ) : null}
                        <Button type="button" variant="outline" size="sm" onClick={() => onDelete(codingAgent)}>
                          <Trash2 className="size-4" />
                          Delete
                        </Button>
                      </div>
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid gap-3 sm:grid-cols-3">
                      {details.map(detail => (
                        <div key={detail.label} className="space-y-1">
                          <dt className="text-muted-foreground text-xs uppercase tracking-wide">{detail.label}</dt>
                          <dd className="break-all text-sm font-medium">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={createType !== null} onOpenChange={open => (!open ? onCloseCreate() : undefined)}>
        <DialogContent className="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {createType ? `Add ${getCodingAgentDefinition(createType).label} configuration` : 'Add configuration'}
            </DialogTitle>
            <DialogDescription>
              Save a reusable coding agent configuration for worker execution. Sensitive credentials will stay hidden
              after this dialog closes.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto pr-1">
            {createType === 'codex' ? (
              <CodexCodingAgentForm
                mode="create"
                isSubmitting={isCreating}
                onCancel={onCloseCreate}
                onSubmit={onCreateSubmit}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget !== null} onOpenChange={open => (!open ? onCloseEdit() : undefined)}>
        <DialogContent className="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editTarget ? `Edit ${editTarget.name}` : 'Edit configuration'}</DialogTitle>
            <DialogDescription>
              Update the Codex model, reasoning effort, default status, or rotate the stored API key.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto pr-1">
            {editTarget ? (
              <CodexCodingAgentForm
                mode="update"
                initialAgent={editTarget}
                isSubmitting={isUpdating}
                onCancel={onCloseEdit}
                onSubmit={onUpdateSubmit}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={open => (!open ? onCloseDelete() : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deleteTarget ? `Delete ${deleteTarget.name}?` : 'Delete configuration?'}</DialogTitle>
            <DialogDescription>
              This removes the saved coding agent configuration. Existing issue snapshots stay unchanged, but new work
              will no longer be able to use this entry.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCloseDelete} disabled={isDeleting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={onConfirmDelete} disabled={isDeleting}>
              {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Delete configuration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export const CodingAgentSettingsSection: React.FC = () => {
  const [createType, setCreateType] = useState<ConfigurableCodingAgentType | null>(null)
  const [editTargetId, setEditTargetId] = useState<string | null>(null)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const { data: codingAgents = [], error, isLoading, refetch } = useCodingAgents()
  const createMutation = useCreateCodingAgent()
  const updateMutation = useUpdateCodingAgent()
  const deleteMutation = useDeleteCodingAgent()

  const editTarget = useMemo(() => {
    const target = codingAgents.find(codingAgent => codingAgent.id === editTargetId) ?? null
    return target && isSupportedCodingAgent(target) ? target : null
  }, [codingAgents, editTargetId])

  const deleteTarget = useMemo(
    () => codingAgents.find(codingAgent => codingAgent.id === deleteTargetId) ?? null,
    [codingAgents, deleteTargetId],
  )

  const handleCreateSubmit = async (codingAgent: CreateCodingAgentManagementInput<'codex'>) => {
    try {
      const createdAgent = await createMutation.mutateAsync(codingAgent)
      setCreateType(null)
      toast.success(`Created ${createdAgent.name}.`)
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : 'Failed to create coding agent.')
    }
  }

  const handleUpdateSubmit = async (codingAgent: UpdateCodingAgentManagementInput<'codex'>) => {
    if (!editTarget) {
      return
    }

    try {
      const updatedAgent = await updateMutation.mutateAsync({
        codingAgentId: editTarget.id,
        codingAgent,
      })
      setEditTargetId(null)
      toast.success(`Updated ${updatedAgent.name}.`)
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : 'Failed to update coding agent.')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) {
      return
    }

    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      setDeleteTargetId(null)
      toast.success(`Deleted ${deleteTarget.name}.`)
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : 'Failed to delete coding agent.')
    }
  }

  return (
    <CodingAgentSettingsSectionView
      codingAgents={codingAgents}
      createType={createType}
      deleteTarget={deleteTarget}
      editTarget={editTarget}
      errorMessage={error instanceof Error ? error.message : null}
      isCreating={createMutation.isPending}
      isDeleting={deleteMutation.isPending}
      isLoading={isLoading}
      isUpdating={updateMutation.isPending}
      onCloseCreate={() => setCreateType(null)}
      onCloseDelete={() => setDeleteTargetId(null)}
      onCloseEdit={() => setEditTargetId(null)}
      onConfirmDelete={() => {
        void handleDelete()
      }}
      onCreate={setCreateType}
      onCreateSubmit={handleCreateSubmit}
      onDelete={codingAgent => setDeleteTargetId(codingAgent.id)}
      onEdit={codingAgent => setEditTargetId(codingAgent.id)}
      onRetry={() => {
        void refetch()
      }}
      onUpdateSubmit={handleUpdateSubmit}
    />
  )
}
