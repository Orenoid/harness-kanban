'use client'

import { LoaderCircle } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import Link from 'next/link'
import React, { useEffect, useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useGithubConnection } from '@/github/hooks/use-github-connection'
import { useGithubBranches, useGithubRepositories } from '@/github/hooks/use-github-repositories'
import { cn } from '@/lib/shadcn/utils'
import { zodResolver } from '@hookform/resolvers/zod'
import { isSupportedGithubRepoReference } from '@repo/shared'
import {
  CreateProjectInput,
  normalizeProjectMcpConfig,
  ProjectDetail,
  ProjectMcpConfig,
  projectMcpConfigSchema,
  UpdateProjectInput,
} from '@repo/shared/project/types'
import { ProjectSearchSelect } from './project-search-select'

const MCP_CONFIG_PLACEHOLDER = `{
  "docs": {
    "type": "streamable-http",
    "url": "https://example.com/mcp"
  },
  "repo-tools": {
    "type": "stdio",
    "command": "node",
    "args": ["scripts/mcp.js", "--port", "3000"],
    "env": {
      "DEBUG": "1"
    }
  }
}`

const parseProjectMcpConfigText = (
  value: string,
): {
  config: ProjectMcpConfig | null
  error: string | null
} => {
  const trimmed = value.trim()
  if (!trimmed) {
    return {
      config: null,
      error: null,
    }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(trimmed)
  } catch {
    return {
      config: null,
      error: 'MCP config must be valid JSON.',
    }
  }

  const parsedConfig = projectMcpConfigSchema.safeParse(parsedJson)
  if (!parsedConfig.success) {
    const issue = parsedConfig.error.issues[0]
    const path = issue?.path?.length ? ` (${issue.path.join('.')})` : ''

    return {
      config: null,
      error: issue ? `${issue.message}${path}` : 'MCP config is invalid.',
    }
  }

  return {
    config: normalizeProjectMcpConfig(parsedConfig.data),
    error: null,
  }
}

const projectFormSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(120, 'Project name must be at most 120 characters'),
  githubRepoUrl: z
    .string()
    .trim()
    .min(1, 'Select a GitHub repository')
    .refine(isSupportedGithubRepoReference, 'Select a GitHub repository'),
  repoBaseBranch: z
    .string()
    .trim()
    .min(1, 'Select a repository base branch')
    .max(255, 'Repository base branch must be at most 255 characters'),
  checkCiCd: z.boolean(),
  mcpConfigText: z.string().superRefine((value, ctx) => {
    const parsed = parseProjectMcpConfigText(value)
    if (parsed.error) {
      ctx.addIssue({
        code: 'custom',
        message: parsed.error,
      })
    }
  }),
})

type ProjectFormValues = z.infer<typeof projectFormSchema>

type ProjectFormBaseProps = {
  initialProject?: Partial<ProjectDetail>
  isSubmitting?: boolean
  submitLabel: string
  onCancel?: () => void
  className?: string
}

type ProjectFormProps =
  | (ProjectFormBaseProps & {
      mode: 'create'
      onSubmit: (payload: CreateProjectInput) => Promise<void> | void
    })
  | (ProjectFormBaseProps & {
      mode: 'update'
      onSubmit: (payload: UpdateProjectInput) => Promise<void> | void
    })

const formatProjectMcpConfig = (config?: ProjectMcpConfig | null): string => {
  const normalizedConfig = normalizeProjectMcpConfig(config)
  return normalizedConfig ? JSON.stringify(normalizedConfig, null, 2) : ''
}

const projectToFormValues = (project?: Partial<ProjectDetail>): ProjectFormValues => ({
  name: project?.name ?? '',
  githubRepoUrl: project?.githubRepoUrl ?? '',
  repoBaseBranch: project?.repoBaseBranch ?? '',
  checkCiCd: project?.checkCiCd ?? false,
  mcpConfigText: formatProjectMcpConfig(project?.mcpConfig),
})

const ReadonlyProjectField: React.FC<{
  label: string
  value: React.ReactNode
}> = ({ label, value }) => {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="break-all text-sm">{value}</div>
    </div>
  )
}

export const ProjectForm: React.FC<ProjectFormProps> = ({
  mode,
  initialProject,
  isSubmitting = false,
  submitLabel,
  onCancel,
  onSubmit,
  className,
}) => {
  const defaultValues = useMemo(() => projectToFormValues(initialProject), [initialProject])
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues,
  })

  const {
    clearErrors,
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
    setValue,
    watch,
  } = form
  const { data: githubConnection, isLoading: isGithubConnectionLoading } = useGithubConnection(mode === 'create')
  const {
    data: githubRepositories = [],
    isLoading: isGithubRepositoriesLoading,
    error: githubRepositoriesError,
  } = useGithubRepositories(mode === 'create' && !!githubConnection?.hasToken)
  const selectedRepoUrl = watch('githubRepoUrl')
  const selectedBranch = watch('repoBaseBranch')
  const selectedRepo = useMemo(
    () => githubRepositories.find(repository => repository.githubRepoUrl === selectedRepoUrl) ?? null,
    [githubRepositories, selectedRepoUrl],
  )
  const {
    data: githubBranches = [],
    isLoading: isGithubBranchesLoading,
    error: githubBranchesError,
  } = useGithubBranches(
    selectedRepo?.fullName ?? '',
    mode === 'create' && !!selectedRepo && !!githubConnection?.hasToken,
  )
  const hasGithubToken = Boolean(githubConnection?.hasToken)

  useEffect(() => {
    reset(defaultValues)
  }, [defaultValues, reset])

  useEffect(() => {
    register('githubRepoUrl')
    register('repoBaseBranch')
  }, [register])

  useEffect(() => {
    if (mode !== 'create' || !selectedRepo) {
      return
    }

    setValue('repoBaseBranch', selectedRepo.defaultBranch, {
      shouldDirty: true,
      shouldValidate: true,
    })
    clearErrors('githubRepoUrl')
  }, [clearErrors, mode, selectedRepo, setValue])

  useEffect(() => {
    if (mode !== 'create' || !selectedRepo || githubBranches.length === 0) {
      return
    }

    const selectedBranchStillExists = githubBranches.some(branch => branch.name === selectedBranch)
    if (selectedBranchStillExists) {
      return
    }

    const defaultBranch = githubBranches.find(branch => branch.isDefault)?.name ?? selectedRepo.defaultBranch
    setValue('repoBaseBranch', defaultBranch, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }, [githubBranches, mode, selectedBranch, selectedRepo, setValue])

  const handleFormSubmit = async (values: ProjectFormValues) => {
    const parsedMcpConfig = parseProjectMcpConfigText(values.mcpConfigText)
    if (parsedMcpConfig.error) {
      form.setError('mcpConfigText', {
        message: parsedMcpConfig.error,
      })
      return
    }

    if (mode === 'create') {
      await onSubmit({
        name: values.name,
        githubRepoUrl: values.githubRepoUrl,
        repoBaseBranch: values.repoBaseBranch,
        checkCiCd: values.checkCiCd,
        ...(parsedMcpConfig.config ? { mcpConfig: parsedMcpConfig.config } : {}),
      })
      return
    }

    await onSubmit({
      name: values.name,
      checkCiCd: values.checkCiCd,
      mcpConfig: parsedMcpConfig.config,
    })
  }

  const repoFieldsDisabled = mode === 'update'
  const showSettingsPrompt = mode === 'create' && !isGithubConnectionLoading && !hasGithubToken
  const submitDisabled = isSubmitting || (mode === 'create' && (!hasGithubToken || isGithubRepositoriesLoading))

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className={cn('space-y-5', className)}>
      <div className="space-y-2">
        <Label htmlFor={`${mode}-project-name`}>Name</Label>
        <Input id={`${mode}-project-name`} {...register('name')} placeholder="Fraud detection service" />
        {errors.name?.message ? <p className="text-sm text-red-500">{errors.name.message}</p> : null}
      </div>

      {showSettingsPrompt ? (
        <div className="rounded-xl bg-amber-50/60 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          <p className="font-medium">GitHub connection required</p>
          <p className="mt-1">
            Add a GitHub token in{' '}
            <Link href="/settings/connections" className="underline underline-offset-4">
              Settings / Connections
            </Link>{' '}
            before creating a project.
          </p>
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          {repoFieldsDisabled ? (
            <ReadonlyProjectField
              label="GitHub repository URL"
              value={
                <a
                  href={defaultValues.githubRepoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-4 hover:underline">
                  {defaultValues.githubRepoUrl}
                </a>
              }
            />
          ) : (
            <>
              <Label htmlFor={`${mode}-project-repo`}>GitHub repository</Label>
              <ProjectSearchSelect
                id={`${mode}-project-repo`}
                value={selectedRepoUrl}
                onValueChange={value => {
                  setValue('githubRepoUrl', value, { shouldDirty: true, shouldValidate: true })
                }}
                options={githubRepositories.map(repository => ({
                  value: repository.githubRepoUrl,
                  label: repository.fullName,
                  description: `Default branch: ${repository.defaultBranch}`,
                }))}
                placeholder={showSettingsPrompt ? 'Configure GitHub in Settings first' : 'Select a repository'}
                searchPlaceholder="Search repositories"
                emptyText={showSettingsPrompt ? 'Configure GitHub in Settings first' : 'No repositories found'}
                loading={isGithubRepositoriesLoading}
                loadingText="Loading..."
                disabled={showSettingsPrompt || isGithubRepositoriesLoading}
              />
              {githubRepositoriesError instanceof Error ? (
                <p className="text-sm text-red-500">{githubRepositoriesError.message}</p>
              ) : null}
              {errors.githubRepoUrl?.message ? (
                <p className="text-sm text-red-500">{errors.githubRepoUrl.message}</p>
              ) : null}
            </>
          )}
        </div>

        <div className="space-y-2">
          {repoFieldsDisabled ? (
            <ReadonlyProjectField
              label="Repository base branch"
              value={<span className="font-mono">{defaultValues.repoBaseBranch}</span>}
            />
          ) : (
            <>
              <Label htmlFor={`${mode}-project-branch`}>Repository base branch</Label>
              {selectedRepo && githubBranchesError instanceof Error ? (
                <>
                  <Input id={`${mode}-project-branch`} value={selectedBranch} readOnly />
                  <p className="text-muted-foreground text-sm">
                    Could not load branches. The project will use the repository default branch.
                  </p>
                </>
              ) : (
                <ProjectSearchSelect
                  id={`${mode}-project-branch`}
                  value={selectedBranch}
                  onValueChange={value => {
                    setValue('repoBaseBranch', value, { shouldDirty: true, shouldValidate: true })
                  }}
                  options={githubBranches.map(branch => ({
                    value: branch.name,
                    label: branch.name,
                    description: branch.isDefault ? 'Default branch' : undefined,
                  }))}
                  placeholder={
                    selectedRepo
                      ? isGithubBranchesLoading
                        ? 'Loading branches...'
                        : 'Select a branch'
                      : 'Select a repository first'
                  }
                  searchPlaceholder="Search branches"
                  emptyText={selectedRepo ? 'No branches found' : 'Select a repository first'}
                  loading={selectedRepo ? isGithubBranchesLoading : false}
                  loadingText="Loading..."
                  disabled={!selectedRepo || isGithubBranchesLoading}
                />
              )}
              {errors.repoBaseBranch?.message ? (
                <p className="text-sm text-red-500">{errors.repoBaseBranch.message}</p>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor={`${mode}-project-ci`} className="text-sm font-medium">
            Check CI/CD
          </Label>
          <p className="text-muted-foreground text-sm">
            Store whether the Coding Agent should later verify CI/CD passes and keep fixing related issues until it
            does.
          </p>
        </div>
        <Controller
          control={control}
          name="checkCiCd"
          render={({ field }) => (
            <Switch
              id={`${mode}-project-ci`}
              checked={field.value}
              onCheckedChange={field.onChange}
              aria-label="Toggle project CI/CD check"
            />
          )}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${mode}-project-mcp-config`}>MCP config (JSON)</Label>
        <Textarea
          id={`${mode}-project-mcp-config`}
          {...register('mcpConfigText')}
          className="min-h-48 font-mono text-sm"
          placeholder={MCP_CONFIG_PLACEHOLDER}
          spellCheck={false}
        />
        <p className="text-muted-foreground text-sm">
          Store project-level MCP servers for Codex. This config is loaded only when a new workspace is created, and
          existing workspaces stay unchanged.
        </p>
        {errors.mcpConfigText?.message ? <p className="text-sm text-red-500">{errors.mcpConfigText.message}</p> : null}
      </div>

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={submitDisabled}>
          {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
