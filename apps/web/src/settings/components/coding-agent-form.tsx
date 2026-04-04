'use client'

import { useForm } from 'react-hook-form'
import { z } from 'zod'
import React, { useEffect, useMemo } from 'react'

import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  CodexReasoningEffort,
  CodingAgentManagementDetail,
  CreateCodingAgentManagementInput,
  UpdateCodingAgentManagementInput,
} from '@repo/shared'

const DEFAULT_CODEX_MODEL = 'gpt-5.3-codex'

const codexReasoningEffortOptions: Array<{
  description: string
  label: string
  value: CodexReasoningEffort
}> = [
  {
    value: 'low',
    label: 'Low',
    description: 'Fastest and least expensive.',
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Balanced for everyday work.',
  },
  {
    value: 'high',
    label: 'High',
    description: 'More deliberate for harder tasks.',
  },
  {
    value: 'xhigh',
    label: 'XHigh',
    description: 'Maximum reasoning depth when latency matters less.',
  },
]

const codexCodingAgentFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name must be at most 120 characters.'),
  model: z.string().trim().min(1, 'Model is required.'),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']),
  apiKey: z.string(),
  isDefault: z.boolean(),
})

type CodexCodingAgentFormValues = z.infer<typeof codexCodingAgentFormSchema>

type CodexCodingAgentFormProps =
  | {
      mode: 'create'
      initialAgent?: undefined
      isSubmitting?: boolean
      onCancel?: () => void
      onSubmit: (codingAgent: CreateCodingAgentManagementInput<'codex'>) => Promise<void> | void
    }
  | {
      mode: 'update'
      initialAgent: CodingAgentManagementDetail<'codex'>
      isSubmitting?: boolean
      onCancel?: () => void
      onSubmit: (codingAgent: UpdateCodingAgentManagementInput<'codex'>) => Promise<void> | void
    }

const toCodexFormValues = (initialAgent?: CodingAgentManagementDetail<'codex'> | null): CodexCodingAgentFormValues => ({
  name: initialAgent?.name ?? '',
  model: initialAgent?.settings.model ?? DEFAULT_CODEX_MODEL,
  reasoningEffort: initialAgent?.settings.reasoningEffort ?? 'medium',
  apiKey: '',
  isDefault: initialAgent?.isDefault ?? false,
})

export const CodexCodingAgentForm: React.FC<CodexCodingAgentFormProps> = ({
  mode,
  initialAgent,
  isSubmitting = false,
  onCancel,
  onSubmit,
}) => {
  const defaultValues = useMemo(() => toCodexFormValues(initialAgent), [initialAgent])
  const form = useForm<CodexCodingAgentFormValues>({
    resolver: zodResolver(codexCodingAgentFormSchema),
    defaultValues,
  })

  useEffect(() => {
    form.reset(defaultValues)
  }, [defaultValues, form])

  const hasStoredCredential = initialAgent?.settings.hasCredential ?? false

  const handleSubmit = async (values: CodexCodingAgentFormValues) => {
    const trimmedApiKey = values.apiKey.trim()

    if (mode === 'create') {
      if (!trimmedApiKey) {
        form.setError('apiKey', {
          message: 'API key is required.',
        })
        return
      }

      await onSubmit({
        name: values.name,
        type: 'codex',
        settings: {
          apiKey: trimmedApiKey,
          model: values.model,
          reasoningEffort: values.reasoningEffort,
        },
        isDefault: values.isDefault,
      })
      return
    }

    if (!trimmedApiKey && !hasStoredCredential) {
      form.setError('apiKey', {
        message: 'API key is required.',
      })
      return
    }

    await onSubmit({
      name: values.name,
      settings: {
        ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
        model: values.model,
        reasoningEffort: values.reasoningEffort,
      },
      isDefault: values.isDefault,
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Primary Codex runner" />
              </FormControl>
              <FormDescription>Use a short label that makes this configuration easy to find later.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-5 md:grid-cols-2">
          <FormField
            control={form.control}
            name="model"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Model</FormLabel>
                <FormControl>
                  <Input {...field} placeholder={DEFAULT_CODEX_MODEL} />
                </FormControl>
                <FormDescription>Choose the Codex model used for worker execution.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="reasoningEffort"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reasoning effort</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select reasoning effort" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {codexReasoningEffortOptions.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  {codexReasoningEffortOptions.find(option => option.value === field.value)?.description ??
                    'Choose how much effort Codex should spend on each run.'}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="apiKey"
          render={({ field }) => (
            <FormItem>
              <FormLabel>API key</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="password"
                  autoComplete="off"
                  placeholder={hasStoredCredential ? '••••••••••••••••' : 'sk-...'}
                />
              </FormControl>
              <FormDescription>
                {hasStoredCredential
                  ? 'Existing credentials stay hidden. Enter a new API key only when you want to replace them.'
                  : 'This key is stored securely and only used for Codex execution.'}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isDefault"
          render={({ field }) => (
            <FormItem className="flex items-start justify-between gap-4 rounded-xl border p-4">
              <div className="space-y-1">
                <FormLabel>Default for Codex</FormLabel>
                <FormDescription>
                  New Codex work will use this configuration first unless another agent is selected explicitly.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-label="Toggle default Codex configuration"
                />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create configuration' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
