# Technical Plan

## Status

**Phase:** Planning

## Requirements Summary

Add frontend management for `project.validation_commands` in the project configuration UI so users can create, edit, and remove validation commands when creating a project and when updating an existing project. Reuse the existing backend CRUD support and shared project DTOs instead of introducing new API or database changes.

## Technical Design

The existing backend already accepts and returns `validationCommands` through `CreateProjectInput`, `UpdateProjectInput`, `ProjectSummary`, and `ProjectDetail` in [`packages/shared/src/project/types.ts`](/workspaces/harness-kanban/packages/shared/src/project/types.ts), and the Nest controller/service already validate and persist the field. The frontend gap is in [`apps/web/src/project/components/project-form.tsx`](/workspaces/harness-kanban/apps/web/src/project/components/project-form.tsx), which currently exposes name, repository, CI/CD, and MCP config fields but never reads or submits `validationCommands`.

Add `validationCommands` to the project form schema and defaults in `project-form.tsx`.

- Extend `projectFormSchema` to include a field backed by `projectValidationCommandsSchema` from `@repo/shared/project/types`, or an equivalent `z.array(z.string())` refinement that preserves the backend rules for trimming, non-empty values, and the 2000-character command limit.
- Extend `ProjectFormValues` / `projectToFormValues` so update mode hydrates existing commands from `initialProject.validationCommands ?? []`.
- Normalize command strings before submit so the UI and API use the same trimmed values.

Implement a dedicated validation-command editor section inside `ProjectForm`.

- Prefer a small extracted presentational helper in the same file or a colocated component such as `ProjectValidationCommandsField` under `apps/web/src/project/components/` to keep `ProjectForm` readable.
- Use `react-hook-form` with `useFieldArray` for the persisted array and a small local editing state (`editingIndex`, `draftValue`) for the inline add/edit interaction described in the issue.
- Render one row per stored command with:
  - the command text in monospace styling,
  - an edit icon button that loads the row into the inline editor,
  - a delete icon button that removes the row from the field array.
- Render an add button below the list. When adding or editing, show an inline text input with save/cancel controls and accessible labels so keyboard users can complete the flow without relying on icon-only affordances.
- Show a helper message when the list is empty so the section does not collapse into a blank state.
- Surface validation errors near the section, including duplicate save attempts with blank input and schema errors returned by the form resolver.

Wire create and update submission payloads to the existing hooks without changing the hooks themselves.

- In create mode, include `validationCommands` in the `CreateProjectInput` payload when the array has entries; sending an empty array is also compatible with the existing API, but omitting empty values keeps the payload aligned with the current `mcpConfig` pattern.
- In update mode, include `validationCommands` in the `UpdateProjectInput` payload, using `null` when the list is cleared so the backend explicitly removes stored commands and keeps parity with the existing nullable update contract.
- No changes should be required in [`apps/web/src/project/hooks/use-create-project.ts`](/workspaces/harness-kanban/apps/web/src/project/hooks/use-create-project.ts) or [`apps/web/src/project/hooks/use-update-project.ts`](/workspaces/harness-kanban/apps/web/src/project/hooks/use-update-project.ts), because they already forward the shared DTO shapes directly to the API.

Update Storybook coverage and mock data so the new form state is exercised in both create and update flows.

- Expand [`apps/web/src/project/components/project-form.stories.tsx`](/workspaces/harness-kanban/apps/web/src/project/components/project-form.stories.tsx) with stories and `play` assertions for:
  - create mode rendering the validation command section,
  - adding a command,
  - editing an existing command,
  - deleting a command,
  - update mode hydrating previously saved commands.
- Update project mocks in [`apps/web/.storybook/msw/apis/projects.ts`](/workspaces/harness-kanban/apps/web/.storybook/msw/apis/projects.ts) and any page-level stories that should display realistic `validationCommands` values, so mock interfaces stay aligned with backend responses.

Verification scope should focus on the actual user workflow, not only unit-level correctness.

- Run the required repo checks from AGENTS.md: `pnpm type-check`, `pnpm build`, `pnpm test`, and for this frontend change `pnpm --filter @harness-kanban/web storybook-alive` followed by `pnpm --filter @harness-kanban/web storybook` if needed, then `pnpm --filter @harness-kanban/web test:storybook`.
- Manually verify the create-project dialog and the project configuration tab in the running app with browser tooling to confirm add/edit/delete interactions, payload persistence after save, and no regressions in GitHub repository/base-branch behavior.
- No database migration, backend API, or infrastructure change is expected for this issue.

## Implementation Steps

1. [ ] Extend `ProjectForm` state, schema, and submit serialization to read, validate, and send `validationCommands` for both create and update modes.
2. [ ] Add the inline validation-command management UI with accessible add/edit/delete interactions and empty/error states, following existing shadcn/Tailwind patterns.
3. [ ] Update Storybook mocks/stories and run the required automated checks plus browser-based manual verification of create/update workflows.

## Review Checklist

Before marking complete, verify all items from the project's Review Rules in AGENTS.md or equivalent guidance.

- [ ] `pnpm type-check` passes.
- [ ] `pnpm build` passes in the repository root.
- [ ] `pnpm test` passes.
- [ ] For this frontend change, `pnpm --filter @harness-kanban/web storybook-alive` is checked, Storybook is started if needed, and `pnpm --filter @harness-kanban/web test:storybook` passes.
- [ ] Browser-based manual verification confirms the new validation-command UI works in both create and update flows.
- [ ] Storybook mocks and frontend payloads use backend-aligned field names and valid values.
- [ ] Any new branch logic has automated coverage, and no Chinese text is introduced in code or comments.

## Notes

This issue appears implementation-ready; the backend contract and persistence already exist, so the work is frontend-only unless manual verification uncovers a contract mismatch. Documentation updates are not currently expected because no scripts, architecture, or developer workflow are being changed, but AGENTS.md should be reviewed again during implementation if the chosen UI pattern introduces a new project convention worth documenting.
