# Technical Plan

## Status

**Phase:** Planning

## Requirements Summary

Remove the "Available now" badge text from the Coding Agent settings page. The badge currently renders `Available now` for coding agent definitions whose `managementAvailability` is `available`, and `Coming soon` for definitions that are not yet available. The requested change removes the "Available now" copy; the "Coming soon" state for unavailable definitions should remain.

## Technical Design

### Scope

- Single frontend file: `apps/web/src/settings/components/coding-agent-settings-section.tsx`.
- No backend, database, or API changes. `managementAvailability` in `packages/shared/src/coding-agent/types.ts` stays untouched; it is still used to gate the "Add configuration" button and the "Coming soon" badge in the saved-configurations list (line 225).

### Change

In the definition card header (currently around line 141-155), replace the always-rendered availability badge:

```tsx
const isAvailable = definition.managementAvailability === 'available'
// ...
<Badge variant={isAvailable ? 'secondary' : 'outline'}>
  {isAvailable ? 'Available now' : 'Coming soon'}
</Badge>
```

with a badge that only renders for unavailable definitions:

```tsx
const isAvailable = definition.managementAvailability === 'available'
// ...
{
  !isAvailable ? <Badge variant="outline">Coming soon</Badge> : null
}
```

Effect:

- Available agents (e.g. Codex, Claude Code) no longer show the redundant "Available now" badge.
- Unavailable agents keep the "Coming soon" badge, preserving the existing hint for definitions that cannot yet be configured.
- `isAvailable` continues to control the card border (`border-dashed`), the "Add configuration" / "Not yet available" button, and the button's `disabled` state — unchanged.

### Test impact

- The page-level Storybook story `apps/web/src/settings/pages/coding-agents-page.stories.tsx` does not assert on the "Available now" text (it waits for "Saved configurations", "Primary Codex", "Legacy Claude Runner", and "Add configuration"). No story change is required, but run the Storybook test runner to confirm.
- If any unit/component tests reference the removed string, update them to assert on "Coming soon" for unavailable agents instead.

## Implementation Steps

1. [ ] Edit `apps/web/src/settings/components/coding-agent-settings-section.tsx` so the availability badge renders only when the definition is unavailable (`Coming soon`), removing the `Available now` copy.
2. [ ] Run `pnpm type-check` and confirm it passes.
3. [ ] Run `pnpm --filter @harness-kanban/web test:storybook` (ensure Storybook is running first via `pnpm --filter @harness-kanban/web storybook` if `storybook-alive` reports it is not).
4. [ ] Run `pnpm test` for affected frontend tests and confirm they pass.
5. [ ] Visually verify in the product (Storybook/dev server) that the Coding Agents page shows no "Available now" badge for available agents while still showing "Coming soon" for unavailable ones.

## Review Checklist

- `pnpm type-check` passes.
- `pnpm build` passes.
- `pnpm test` passes.
- `pnpm --filter @harness-kanban/web test:storybook` passes.
- The "Available now" string no longer appears anywhere in `apps/web`.
- No Chinese text introduced in code or comments.
- Change verified in the running product/Storybook, not just by unit tests.

## Notes

- The issue only asks to remove the "Available now" copy. The "Coming soon" badge and the availability-gated interactions (button disabled state, dashed border) are intentionally preserved.
- Branch: `feat/web-remove-available-now-badge`.
