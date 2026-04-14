# Technical Plan

## Status

**Phase:** Planning

## Requirements Summary

Fix the bug where issue descriptions are sometimes not saved during creation or update. The root causes are excessive debounce delays (5000 ms in `TiptapEditor` stacked with 800 ms in `DetailPage`), missing blur-based flush, and no unmount cleanup for pending debounced updates.

## Technical Design

### Root Cause Analysis

1. **Stacked debounce delays**: `TiptapEditor` defaults to `debounceMs = 5000` and `EditableDescription` uses `updateMode="debounced"`. `DetailPage` adds another `DEBOUNCE_DELAY_MS = 800` on top. The total delay from the last keystroke to the API call is ~5800 ms, so users who navigate away or click Create before the timeout expires lose their latest edits.
2. **No blur flush**: `EditableDescription` only passes `onUpdate` to `TiptapEditor` and omits `onBlur`. When the user clicks outside the editor, the internal 5000 ms debounce is not flushed, so the latest value never reaches the form state (create) or the detail-page patch handler (update).
3. **No unmount cleanup**: `useDebouncedCallback` does not expose `flush` or `cancel`, and neither `TiptapEditor` nor `DetailPage` flushes pending debounces on unmount or navigation.
4. **Query invalidation race in `DetailPage`**: `editedValues` is cleared when the `issue` query refetches. If the user types during the API call, the refetched stale server response can overwrite the optimistic local state.

### Proposed Changes

#### 1. Reduce and align debounce delays

- Change `TiptapEditor` default `debounceMs` from `5000` to `500`.
- Rationale: 500 ms is long enough to batch rapid keystrokes but short enough that users are unlikely to navigate away before the update propagates.

#### 2. Add `onBlur` flush in `EditableDescription`

- Pass an `onBlur` prop to `TiptapEditor` that calls the same `onChange` handler.
- In `TiptapEditor`, when `onBlur` fires, also **flush** any pending debounced `onUpdate` so the final value is emitted immediately.

#### 3. Refactor `useDebouncedCallback` to support `flush` and `cancel`

- Replace the current `setTimeout`-based hook with a memoized `lodash-es/debounce` instance that returns both the debounced function and a `flush`/`cancel` API.
- Alternatively, change `useDebouncedCallback` to return an object `{ call, flush, cancel }` so callers can clean up on unmount/blur.

#### 4. Flush debounces on unmount in `TiptapEditor`

- In a `useEffect` cleanup function, call `debouncedUpdate.cancel()` (or `flush()`, depending on desired UX; prefer `flush` for save-on-unmount).

#### 5. Flush debounced patches on unmount in `DetailPage`

- In a `useEffect` cleanup, iterate over `debouncedPatchRef.current` and call `.flush()` on each active debounce so in-flight edits are sent before the component unmounts.

#### 6. Fix query invalidation race in `DetailPage`

- Change the `useEffect` that clears `editedValues` to only delete keys whose server value **matches** the local edited value. If the user typed while the request was in flight, keep the newer local value until the next refetch catches up.

### Files to Modify

| File                                                                           | Change                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `apps/web/src/components/core/editor/tiptap-editor.tsx`                        | Reduce default `debounceMs`; flush/cancel debounce on unmount and blur                      |
| `apps/web/src/hooks/use-debounce.ts`                                           | Add `flush` and `cancel` APIs                                                               |
| `apps/web/src/property/components/fields/description/editable-description.tsx` | Pass `onBlur={onChange}` to `TiptapEditor`                                                  |
| `apps/web/src/issue/pages/detail-page.tsx`                                     | Flush debounced patches on unmount; fix race when clearing `editedValues`                   |
| `apps/web/src/issue/pages/create-page.tsx`                                     | Ensure description value is flushed before `handleSubmit` (leverage blur or lower debounce) |

### Test Cases

- Unit test for `useDebouncedCallback`: verify `flush` invokes callback immediately and `cancel` prevents invocation.
- Component test for `TiptapEditor`: verify `onUpdate` is called immediately on blur when a debounce was pending.
- Integration test for `DetailPage`: simulate typing, unmount, and assert `updateIssue` is called with the final value.
- Storybook play function for `EditableDescription`: type text, blur, and assert `onChange` receives the final value.

## Implementation Steps

1. [ ] Refactor `useDebouncedCallback` to expose `flush` and `cancel` using `lodash-es/debounce`.
2. [ ] Update `TiptapEditor` to reduce default `debounceMs` to 500 ms, flush pending debounce on `onBlur`, and cancel/flush on unmount.
3. [ ] Update `EditableDescription` to pass `onBlur={onChange}` so blur forces the latest description value upward.
4. [ ] Update `DetailPage` to flush all debounced patches in a `useEffect` cleanup, and adjust the `editedValues` reset logic to avoid overwriting newer local values.
5. [ ] Update `create-page.tsx` to ensure the form reads the latest editor value (already addressed by reduced debounce + blur flush).
6. [ ] Add/update unit tests for `use-debounce`, `TiptapEditor`, and `DetailPage` save flow.
7. [ ] Run `pnpm type-check`, `pnpm build`, and `pnpm test` to verify no regressions.

## Review Checklist

- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes in root project
- [ ] `pnpm test` passes
- [ ] Frontend hooks and Storybook mock structures align with backend API interfaces
- [ ] New/changed logic has unit or E2E test coverage
- [ ] No Chinese text in code or comments

## Notes

- The original 5000 ms debounce was likely intended to reduce API pressure, but it is unsafe for a field that users expect to persist quickly. The combined fix of a shorter debounce + blur flush + unmount flush preserves performance while ensuring data integrity.
- If further API throttling is needed, consider debouncing only the network layer (`DetailPage`'s 800 ms) and making the editor propagate values immediately or with a very short delay (≤ 500 ms).
