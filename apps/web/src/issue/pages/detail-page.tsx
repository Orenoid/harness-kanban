'use client'

import debounce from 'lodash-es/debounce'
import groupBy from 'lodash-es/groupBy'
import { toast } from 'sonner'
import { useParams, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ErrorTooltipIcon } from '@/components/common/error-tooltip-icon'
import { GlobalLoading } from '@/components/common/global-loading'
import { LayoutSlot } from '@/components/layout/layout-slot'
import { ActivityList } from '@/issue/components/activity/activity-list'
import { EnhancedCommentForm } from '@/issue/components/comment/enhanced-comment-form'
import { IssuePageBreadcrumbs } from '@/issue/components/issue-page-breadcrumbs'
import { useIssue } from '@/issue/hooks/use-issue'
import { useUpdateIssue } from '@/issue/hooks/use-update-issue'
import { IssueRowType } from '@/issue/types/issue-types'
import { parseIssueNavigationContext } from '@/issue/utils/navigation-context'
import { convertIssueToRow } from '@/issue/utils/transform'
import { useIssuePropertyMetas } from '@/property/hooks/use-issue-property-metas'
import {
  getEditableRenderer,
  getReadonlyRenderer,
  getRenderer,
  shouldRenderProperty,
} from '@/property/registry/property-registry'
import { PropertyMeta, PropertyValueType } from '@/property/types/property-types'
import { SystemPropertyId } from '@repo/shared/property/constants'
import { Operation } from '@repo/shared/property/types'
import { useQueryClient } from '@tanstack/react-query'

const DEBOUNCE_DELAY_MS = 800

interface DetailPageViewProps {
  issueId: number
  fields: PropertyMeta[]
  row: IssueRowType
  editedValues: Record<string, unknown>
  navigationContext: ReturnType<typeof parseIssueNavigationContext>
  getValue: (propertyId: string) => PropertyValueType
  getOnChangeHandler: (propertyId: string) => (value: unknown) => void
  setValues: (updates: Record<string, unknown>) => void
}

export const DetailPageView: React.FC<DetailPageViewProps> = ({
  issueId,
  fields,
  row,
  editedValues,
  navigationContext,
  getValue,
  getOnChangeHandler,
  setValues,
}) => {
  const grouped = useMemo(() => groupBy(fields, field => field?.group?.label || ''), [fields])
  const mainFields = [SystemPropertyId.TITLE, SystemPropertyId.DESCRIPTION]

  return (
    <>
      <div className="bg-background sticky top-0 z-30 w-full border-b">
        <LayoutSlot className="container mx-auto flex h-[var(--navbar-height)] max-w-6xl items-center px-2 md:px-6">
          <LayoutSlot className="flex h-[var(--navbar-height)] flex-1 items-center">
            <IssuePageBreadcrumbs
              currentLabel={
                typeof row[SystemPropertyId.TITLE] === 'string'
                  ? String(row[SystemPropertyId.TITLE])
                  : `Issue #${issueId}`
              }
              context={navigationContext}
            />
          </LayoutSlot>
        </LayoutSlot>
      </div>

      <LayoutSlot className="container mx-auto max-w-6xl flex-1 px-2 py-4 md:px-6">
        <div className="grid w-full auto-rows-min grid-cols-1 items-start gap-x-8 gap-y-4 md:grid-cols-10">
          <div className="order-1 md:order-2 md:col-span-2 md:border-l">
            {Object.entries(grouped).map(([groupTitle, groupFields]) => {
              const sidebarFields = groupFields.filter(f => !mainFields.includes(f.core.propertyId as SystemPropertyId))
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
                        const Renderer =
                          propertyId === SystemPropertyId.PROJECT
                            ? getReadonlyRenderer(propertyId)
                            : getRenderer(propertyId)
                        if (!Renderer) return false
                        return shouldRenderProperty(propertyId, getValue)
                      })
                      .map(field => {
                        const propertyId = field.core.propertyId
                        const Renderer =
                          propertyId === SystemPropertyId.PROJECT
                            ? getReadonlyRenderer(propertyId)
                            : getRenderer(propertyId)
                        if (!Renderer) return null
                        const value = (
                          propertyId in editedValues ? editedValues[propertyId] : row[propertyId]
                        ) as PropertyValueType
                        return (
                          <div key={propertyId} className="flex min-h-8 items-center gap-2 px-3">
                            <Renderer
                              meta={field}
                              value={value}
                              row={row}
                              onChange={
                                propertyId === SystemPropertyId.PROJECT ? undefined : getOnChangeHandler(propertyId)
                              }
                              getValue={getValue}
                              setValues={setValues}
                            />
                            <ErrorTooltipIcon message="" />
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
              const value = (
                propertyId in editedValues ? editedValues[propertyId] : row[propertyId]
              ) as PropertyValueType
              return (
                <div key={propertyId} className="space-y-1">
                  <Renderer value={value} onChange={getOnChangeHandler(propertyId)} meta={field} />
                </div>
              )
            })}

            <div className="mt-6 px-0">
              <EnhancedCommentForm issueId={issueId} />
              <div className="mb-10 mt-4">
                <ActivityList issueId={issueId} />
              </div>
            </div>
          </div>
        </div>
      </LayoutSlot>
    </>
  )
}

export const DetailPage = () => {
  const { id } = useParams()
  const searchParams = useSearchParams()
  const issueId = Number(id)
  const navigationContext = parseIssueNavigationContext(searchParams)

  const fields = useIssuePropertyMetas()
  const { issue, isLoading } = useIssue(issueId)
  const { updateIssue } = useUpdateIssue(issueId)
  const queryClient = useQueryClient()

  const [editedValues, setEditedValues] = useState<Record<string, unknown>>({})

  const rollbackEditedValue = useCallback((propertyId: string) => {
    setEditedValues(prev => {
      if (!(propertyId in prev)) {
        return prev
      }

      const next = { ...prev }
      delete next[propertyId]
      return next
    })
  }, [])

  const row = useMemo(() => {
    if (!issue) return {} as IssueRowType
    return convertIssueToRow(issue)
  }, [issue])

  const handlePatch = useCallback(
    async (propertyId: string, value: unknown) => {
      const isClear = value === null || value === undefined || (typeof value === 'string' && value.trim() === '')

      const operations: Operation[] = []
      if (isClear) {
        operations.push({
          propertyId: propertyId,
          operationType: 'clear',
          operationPayload: {},
        })
      } else {
        operations.push({
          propertyId: propertyId,
          operationType: 'set',
          operationPayload: { value },
        })
      }
      try {
        await updateIssue({ operations })
        void queryClient.invalidateQueries({ queryKey: ['api-server', 'issue', issueId] })
      } catch (error) {
        rollbackEditedValue(propertyId)
        void queryClient.invalidateQueries({ queryKey: ['api-server', 'issue', issueId] })
        toast.error(`Failed to update: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    },
    [issueId, queryClient, rollbackEditedValue, updateIssue],
  )

  const debouncedPatchRef = useRef<Record<string, ReturnType<typeof debounce>>>({})

  const getDebouncedPatch = useCallback(
    (propertyId: string) => {
      if (!debouncedPatchRef.current[propertyId]) {
        debouncedPatchRef.current[propertyId] = debounce(async (value: unknown) => {
          const operations: Operation[] = [
            {
              propertyId: propertyId,
              operationType: 'set',
              operationPayload: { value },
            },
          ]
          try {
            await updateIssue({ operations })
            void queryClient.invalidateQueries({ queryKey: ['api-server', 'issue', issueId] })
          } catch (error) {
            rollbackEditedValue(propertyId)
            void queryClient.invalidateQueries({ queryKey: ['api-server', 'issue', issueId] })
            toast.error(`Failed to update: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }, DEBOUNCE_DELAY_MS)
      }
      return debouncedPatchRef.current[propertyId]
    },
    [issueId, queryClient, rollbackEditedValue, updateIssue],
  )

  const getOnChangeHandler = (propertyId: string) => {
    const patchFn =
      propertyId === SystemPropertyId.TITLE || propertyId === SystemPropertyId.DESCRIPTION
        ? getDebouncedPatch(propertyId)
        : (val: unknown) => handlePatch(propertyId, val)

    return (val: unknown) => {
      setEditedValues(prev => ({ ...prev, [propertyId]: val }))
      patchFn(val)
    }
  }

  const getValue = useCallback(
    (propertyId: string) =>
      (propertyId in editedValues ? editedValues[propertyId] : row[propertyId]) as PropertyValueType,
    [editedValues, row],
  )

  const setValues = useCallback(
    (updates: Record<string, unknown>) => {
      setEditedValues(prev => ({ ...prev, ...updates }))
      for (const [propertyId, value] of Object.entries(updates)) {
        const patchFn =
          propertyId === SystemPropertyId.TITLE || propertyId === SystemPropertyId.DESCRIPTION
            ? getDebouncedPatch(propertyId)
            : (val: unknown) => handlePatch(propertyId, val)
        patchFn(value)
      }
    },
    [getDebouncedPatch, handlePatch],
  )

  useEffect(() => {
    if (!issue) return
    const updatedKeys = issue.propertyValues.map(p => p.propertyId)
    setEditedValues(prev => {
      const next = { ...prev }
      for (const key of updatedKeys) {
        if (next[key] === undefined) continue
        // Only clear edited value if the server value now matches what we sent.
        // This prevents the stale server response from overwriting newer local input.
        const serverValue = row[key]
        if (next[key] === serverValue) {
          delete next[key]
        }
      }
      return next
    })
  }, [issue, row])

  // Flush pending debounced patches on unmount so edits are not lost
  useEffect(() => {
    return () => {
      const currentRef = debouncedPatchRef.current
      for (const debouncedFn of Object.values(currentRef)) {
        debouncedFn.flush()
      }
    }
  }, [])

  if (isLoading || !issue) {
    return <GlobalLoading />
  }

  return (
    <DetailPageView
      issueId={issueId}
      fields={fields}
      row={row}
      editedValues={editedValues}
      navigationContext={navigationContext}
      getValue={getValue}
      getOnChangeHandler={getOnChangeHandler}
      setValues={setValues}
    />
  )
}
