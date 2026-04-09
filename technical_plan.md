# Technical Plan

## Status

**Phase:** Planning

## Requirements Summary

Remove the subscribers UI from the issue activity section. The component implementation code (`subscribers-section.tsx`) should be preserved - only the usage/display needs to be removed. No backend changes are required.

## Technical Design

### Files to Modify

1. **`apps/web/src/issue/components/activity/activity-list.tsx`**
   - Remove the import of `SubscribersSection` component (line 10)
   - Remove the `<SubscribersSection issueId={issueId} />` usage from the `ActivityListView` component (line 38)
   - The component should be removed from the LayoutSlot that currently wraps it alongside the "Activity" title

### Changes Detail

#### `activity-list.tsx`

**Before:**

```tsx
import { SubscribersSection } from './subscribers-section'

// In ActivityListView component:
;<LayoutSlot className="mb-2 flex items-center justify-between px-2">
  <LayoutSlot className="shrink-0 text-lg font-medium">Activity</LayoutSlot>
  <SubscribersSection issueId={issueId} />
</LayoutSlot>
```

**After:**

```tsx
// Remove SubscribersSection import

// In ActivityListView component:
<LayoutSlot className="mb-2 flex items-center justify-between px-2">
  <LayoutSlot className="shrink-0 text-lg font-medium">Activity</LayoutSlot>
  {/* SubscribersSection removed as per requirement */}
</LayoutSlot>
```

### Preserved Components (DO NOT DELETE)

The following component files should remain intact as per the requirement:

- `apps/web/src/issue/components/activity/subscribers-section.tsx` - The full implementation including `SubscribersSection`, `SubscribersSectionView`, `SubscriberAvatar`, and `SubscriberAvatarView`
- All related hooks: `use-subscribe-issue.ts`, `use-unsubscribe-issue.ts`, `use-issue-activities.ts`

### No Backend Changes

Per the issue requirements, no backend API changes are needed. The subscription endpoints will remain functional.

## Implementation Steps

1. [ ] Remove `SubscribersSection` import from `activity-list.tsx`
2. [ ] Remove `<SubscribersSection issueId={issueId} />` JSX element from `ActivityListView`
3. [ ] Run type-check to ensure no TypeScript errors
4. [ ] Verify the change in Storybook if applicable

## Review Checklist

Before marking complete, verify all items from the project's Review Rules:

- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes in root project
- [ ] Frontend changes verified - subscribers section no longer appears in issue activity
- [ ] No Chinese text in code or comments
- [ ] Follow existing code patterns

## Notes

- This is a minimal UI-only change that removes the display of the subscribers section from the activity list
- The subscribers functionality remains available via the preserved component code and can be re-enabled or moved elsewhere if needed
- The "Activity" title will remain, but without the subscribers section on the right side
