'use client'

import groupBy from 'lodash-es/groupBy'
import { FormProvider, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { NextPage } from 'next'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo } from 'react'

import { ErrorTooltipIcon } from '@/components/common/error-tooltip-icon'
import { GlobalLoading } from '@/components/common/global-loading'
import { LayoutSlot } from '@/components/layout/layout-slot'
import { Button } from '@/components/ui/button'
import { IssuePageBreadcrumbs } from '@/issue/components/issue-page-breadcrumbs'
import { useCreateIssue } from '@/issue/hooks/use-create-issue'
import { parseIssueNavigationContext, resolveIssueBackTarget } from '@/issue/utils/navigation-context'
import { getZodSchemaFromPropertyMetas } from '@/property/forms/get-zod-schema'
import { useIssuePropertyMetas } from '@/property/hooks/use-issue-property-metas'
import { getEditableRenderer, shouldRenderProperty } from '@/property/registry/property-registry'
import { PropertyMeta } from '@/property/types/property-types'
import { zodResolver } from '@hookform/resolvers/zod'
import { PropertyValue, SystemPropertyId } from '@repo/shared'

interface NewIssuePageViewProps {
  fields: PropertyMeta[]
  isCreating: boolean
  navigationContext: ReturnType<typeof parseIssueNavigationContext>
  onCancel: () => void
  onCreateIssue: (payload: { propertyValues: PropertyValue[] }) => Promise<void>
  initialValues?: Record<string, unknown>
}

export const NewIssuePageView: NextPage<NewIssuePageViewProps> = ({
  fields,
  isCreating,
  navigationContext,
  onCancel,
  onCreateIssue,
  initialValues = {},
}) => {
  const schema = useMemo(() => getZodSchemaFromPropertyMetas(fields), [fields])
  const defaultValues = useMemo(
    () => ({
      ...Object.fromEntries(fields.map(f => [f.core.propertyId, f.core.defaultValue ?? undefined])),
      ...initialValues,
    }),
    [fields, initialValues],
  )

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const {
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = form

  useEffect(() => {
    if (fields.length === 0) return
    const defaults = {
      ...Object.fromEntries(fields.map(f => [f.core.propertyId, f.core.defaultValue ?? undefined])),
      ...initialValues,
    }
    form.reset(defaults)
  }, [fields, form, initialValues])

  const onSubmit = (formValues: Record<string, unknown>) => {
    const propertyValues = Object.entries(formValues)
      .map(([key, value]) => ({
        propertyId: key,
        value: value as unknown,
      }))
      .filter(item => item.value !== undefined)

    void onCreateIssue({ propertyValues })
  }

  const grouped = groupBy(fields, field => field?.group?.label || '')
  const mainFields = [SystemPropertyId.TITLE, SystemPropertyId.DESCRIPTION]

  return (
    <>
      <div className="bg-background sticky top-0 z-30 w-full border-b">
        <LayoutSlot className="container mx-auto flex h-[var(--navbar-height)] max-w-6xl items-center px-2 md:px-6">
          <LayoutSlot className="flex h-[var(--navbar-height)] flex-1 items-center">
            <IssuePageBreadcrumbs currentLabel="New Issue" context={navigationContext} />
          </LayoutSlot>
        </LayoutSlot>
      </div>

      <LayoutSlot className="container mx-auto max-w-6xl flex-1 px-2 py-4 md:px-6">
        <FormProvider {...form}>
          {fields.length === 0 ? (
            <GlobalLoading />
          ) : (
            <div className="grid w-full auto-rows-min grid-cols-1 items-start gap-x-8 gap-y-4 md:grid-cols-10">
              <div className="order-1 md:order-2 md:col-span-2 md:border-l">
                {Object.entries(grouped).map(([groupTitle, groupFields]) => {
                  const sidebarFields = groupFields.filter(
                    f => !mainFields.includes(f.core.propertyId as SystemPropertyId),
                  )
                  if (sidebarFields.length === 0) return null
                  return (
                    <div key={groupTitle} className="mb-2">
                      <h2 className="mb-2 mt-4 px-3 text-sm font-semibold text-gray-600">{groupTitle}</h2>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-1">
                        {sidebarFields
                          .filter(field => {
                            return field?.display?.defaultVisible ?? true
                          })
                          .filter(field => {
                            const propertyId = field.core.propertyId
                            const Renderer = getEditableRenderer(propertyId)
                            if (!Renderer) return false
                            return shouldRenderProperty(propertyId, id => watch(id))
                          })
                          .map(field => {
                            const propertyId = field.core.propertyId
                            const Renderer = getEditableRenderer(propertyId)!
                            const value = watch(propertyId)
                            return (
                              <div key={propertyId} className="flex flex-row items-center space-x-1">
                                <Renderer
                                  meta={field}
                                  value={value ?? ''}
                                  onChange={val => setValue(propertyId, val)}
                                  getValue={id => watch(id)}
                                  setValues={updates => {
                                    Object.entries(updates).forEach(([id, val]) => {
                                      setValue(id, val)
                                    })
                                  }}
                                />
                                <ErrorTooltipIcon message={errors[propertyId]?.message as string} />
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="order-2 space-y-6 px-2 md:order-1 md:col-span-8">
                {mainFields.map(propertyId => {
                  const field = fields.find(f => f.core.propertyId === propertyId)
                  if (!field) return null
                  const Renderer = getEditableRenderer(propertyId)
                  if (!Renderer) return null
                  const value = watch(propertyId)
                  return (
                    <div key={propertyId} className="space-y-1">
                      <Renderer value={value ?? ''} onChange={val => setValue(propertyId, val)} meta={field} />
                      {errors[propertyId]?.message && (
                        <p className="text-sm text-red-500">{errors[propertyId]?.message as string}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </FormProvider>
      </LayoutSlot>

      <LayoutSlot className="container mx-auto max-w-6xl px-2 md:px-6">
        <div className="bg-background/80 sticky bottom-0 z-20 -mx-2 py-4 backdrop-blur sm:mx-0">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={handleSubmit(onSubmit)} disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </div>
      </LayoutSlot>
    </>
  )
}

export const NewIssuePage: NextPage = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fields = useIssuePropertyMetas()
  const { createIssue, isMutating: isCreating } = useCreateIssue()
  const navigationContext = parseIssueNavigationContext(searchParams)

  const initialValues = useMemo(() => {
    if (navigationContext?.source !== 'project') {
      return {}
    }

    return {
      [SystemPropertyId.PROJECT]: navigationContext.projectId,
    }
  }, [navigationContext])

  const handleCancel = () => {
    const backTarget = resolveIssueBackTarget(navigationContext)
    router.push(backTarget.href)
  }

  const handleCreateIssue = async ({ propertyValues }: { propertyValues: PropertyValue[] }) => {
    try {
      const { issueId: createdIssueId } = await createIssue({ propertyValues })
      toast.success(`Issue #${createdIssueId} created successfully.`)
      setTimeout(() => {
        const backTarget = resolveIssueBackTarget(navigationContext)
        router.push(backTarget.href)
      })
    } catch (error) {
      toast.error(`Failed to create issue: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  return (
    <NewIssuePageView
      fields={fields}
      isCreating={isCreating}
      navigationContext={navigationContext}
      onCancel={handleCancel}
      onCreateIssue={handleCreateIssue}
      initialValues={initialValues}
    />
  )
}
