'use client'

import { toast } from 'sonner'
import React, { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useDeleteGithubConnection,
  useGithubConnection,
  useUpdateGithubConnection,
} from '@/github/hooks/use-github-connection'
import { GithubConnectionStatus } from '@repo/shared'

interface GithubConnectionSectionViewProps {
  connection: GithubConnectionStatus | null
  isDeleting: boolean
  isLoading: boolean
  isSaving: boolean
  onDelete: () => void
  onSave: () => void
  onTokenChange: (value: string) => void
  token: string
}

export const GithubConnectionSectionView: React.FC<GithubConnectionSectionViewProps> = ({
  connection,
  isDeleting,
  isLoading,
  isSaving,
  onDelete,
  onSave,
  onTokenChange,
  token,
}) => {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">GitHub</h2>
        <p className="text-muted-foreground text-sm">
          Add a GitHub personal access token to browse repositories and branches while creating projects.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="github-token">Personal access token</Label>
        <Input
          id="github-token"
          type="password"
          value={token}
          onChange={event => onTokenChange(event.target.value)}
          placeholder={connection?.hasToken && !token ? '********************' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
          autoComplete="off"
        />
        <p className="text-muted-foreground text-sm">
          {connection?.hasToken
            ? 'A GitHub token is already saved. Paste a new one here to replace it.'
            : 'Your token is encrypted before it is stored.'}
        </p>
        {isLoading ? <p className="text-muted-foreground text-sm">Loading connection status...</p> : null}
      </div>

      <div className="bg-muted/40 space-y-2 rounded-xl p-4 text-sm">
        <p className="font-medium">How to get your GitHub token:</p>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-5">
          <li>
            Visit{' '}
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4">
              https://github.com/settings/tokens
            </a>
          </li>
          <li>Create a personal access token.</li>
          <li>Grant access to the repositories you want to use in Harness Kanban, then copy the token here.</li>
        </ol>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {connection?.hasToken ? (
          <Button type="button" variant="outline" onClick={onDelete} disabled={isDeleting || isSaving}>
            {isDeleting ? 'Removing...' : 'Remove token'}
          </Button>
        ) : null}
        <Button type="button" onClick={onSave} disabled={!token.trim() || isSaving || isDeleting}>
          {isSaving ? 'Saving...' : connection?.hasToken ? 'Update token' : 'Save token'}
        </Button>
      </div>
    </section>
  )
}

export const GithubConnectionSection: React.FC = () => {
  const [token, setToken] = useState('')
  const { data: connection = null, isLoading } = useGithubConnection()
  const updateMutation = useUpdateGithubConnection()
  const deleteMutation = useDeleteGithubConnection()

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ token })
      setToken('')
      toast.success('GitHub token saved.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save GitHub token.')
    }
  }

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync()
      setToken('')
      toast.success('GitHub token removed.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove GitHub token.')
    }
  }

  return (
    <GithubConnectionSectionView
      connection={connection}
      isDeleting={deleteMutation.isPending}
      isLoading={isLoading}
      isSaving={updateMutation.isPending}
      onDelete={() => {
        void handleDelete()
      }}
      onSave={() => {
        void handleSave()
      }}
      onTokenChange={setToken}
      token={token}
    />
  )
}
