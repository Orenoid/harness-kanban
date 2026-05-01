import React from 'react'

import { Activity } from '@repo/shared/issue/types'

export interface ActivityRendererProps {
  activity: Activity
}
export type ActivityRendererComponent = React.FC<ActivityRendererProps>

export interface ActivityBehavior {
  shouldDisplay?: (activity: Activity) => boolean
  renderer?: ActivityRendererComponent
}

const activityBehaviorRegistry = new Map<string, ActivityBehavior>()

export const registerActivityBehavior = (propertyId: string, behavior: ActivityBehavior) => {
  activityBehaviorRegistry.set(propertyId, behavior)
}

export const getActivityBehavior = (propertyId: string): ActivityBehavior | undefined => {
  return activityBehaviorRegistry.get(propertyId)
}

export const shouldDisplayActivity = (activity: Activity): boolean => {
  const propertyId = 'propertyId' in activity.payload ? activity.payload.propertyId : undefined
  if (!propertyId) return true

  const behavior = getActivityBehavior(propertyId)
  return behavior?.shouldDisplay?.(activity) ?? true
}
