'use client'

import React, { useMemo } from 'react'

import { LayoutSlot } from '@/components/layout/layout-slot'
import { useIssueActivities } from '@/issue/hooks/use-issue-activities'
import { shouldDisplayActivity } from '@/issue/registry/activity-behavior-registry'
import { Activity } from '@repo/shared/issue/types'
import { ActivityItem } from './activity-item'

interface ActivityListProps {
  issueId: number
}

interface ActivityListViewProps extends ActivityListProps {
  activities: Activity[]
  isLoading: boolean
}

export const ActivityListView: React.FC<ActivityListViewProps> = ({ activities, isLoading }) => {
  const sortedActivities = useMemo(() => {
    return [...activities].sort((a, b) => {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
  }, [activities])

  const displayedActivities = useMemo(() => {
    return sortedActivities.filter(activity => shouldDisplayActivity(activity))
  }, [sortedActivities])

  if (isLoading) return null

  return (
    <div className="mt-6 px-0 py-2">
      <LayoutSlot className="mb-2 flex items-center justify-between px-2">
        <LayoutSlot className="shrink-0 text-lg font-medium">Activity</LayoutSlot>
      </LayoutSlot>
      <div className="space-y-4">
        {displayedActivities.map(activity => (
          <ActivityItem key={activity.id} activity={activity} />
        ))}
      </div>
    </div>
  )
}

export const ActivityList: React.FC<ActivityListProps> = ({ issueId }) => {
  const { data, isLoading } = useIssueActivities(issueId)

  return <ActivityListView issueId={issueId} activities={data?.activities ?? []} isLoading={isLoading || !data} />
}
