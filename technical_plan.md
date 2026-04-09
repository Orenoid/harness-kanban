# Technical Plan

## Status

**Phase:** Planning

## Requirements Summary

Add a UI section in the project configuration form to manage `validation_commands` - an array of command strings used for project validation. This applies to both creating and updating a project.

The UI should display:

- A list of existing validation commands with edit and delete actions per command
- An "add new command" button/icon to append new commands

## Technical Design

### Overview

The validation commands UI will be integrated into the existing `ProjectForm` component. It will follow the existing form patterns using `react-hook-form` with zod validation, similar to how other project fields are handled.

### Changes Required

#### 1. Frontend Types & Schema (`apps/web/src/project/components/project-form.tsx`)

**Schema Updates:**

- Add `validationCommands` field to the `projectFormSchema` zod schema
- Use `projectValidationCommandsSchema` from `@repo/shared/project/types` for validation
- Add form-level validation to ensure commands are non-empty and within length limits (2000 chars)

**Form Values Interface:**

- Extend `ProjectFormValues` type to include `validationCommands: string[]`

**Helper Functions:**

- Update `projectToFormValues` to initialize `validationCommands` from `project.validationCommands ?? []`
- Update form submission handlers to include `validationCommands` in the payload for both create and update modes

#### 2. UI Component Implementation (`apps/web/src/project/components/project-form.tsx`)

**New Component: `ValidationCommandsField`**
A sub-component within the form file that renders:

- Section label "Validation Commands"
- List of command inputs with:
  - Text input for each command (monospace font for command readability)
  - Edit/save toggle button per row (or inline editing)
  - Delete button per row (with confirmation)
- "Add command" button at the bottom

**UI Behavior:**

- Empty state: Show placeholder text or message when no commands exist
- Inline editing: Click edit icon to enable input, click save/confirm to disable
- Delete with confirmation: Optional simple confirmation before removal
- Input validation: Real-time validation showing error if command is empty or too long
- Maximum character display: Show character count near input if approaching limit

**Design Patterns:**

- Use existing UI components: `Input`, `Button`, `Label` from `@/components/ui`
- Icons: Use `Pencil`, `Trash2`, `Plus`, `Check`, `X` from `lucide-react`
- Layout: Stack commands vertically with consistent spacing (similar to how list items are displayed elsewhere)
- Button sizes: Use `size="sm"` or `size="icon"` for action buttons

#### 3. Storybook Stories Update (`apps/web/src/project/components/project-form.stories.tsx`)

**Update Existing Stories:**

- `CreateMode`: Verify validation commands section renders and add play function interactions
- `UpdateMode`: Include `validationCommands` in the mock project data

**New Stories:**

- `UpdateModeWithValidationCommands`: Story showing multiple validation commands
- `ValidationCommandsEmptyState`: Story showing the empty state UI

**Mock Data:**

- Add `validationCommands: ['pnpm lint', 'pnpm type-check', 'pnpm test']` to mock project data

#### 4. E2E Test Updates (if applicable)

**Test Scenarios:**

- Create project with validation commands
- Update project to add/remove/edit validation commands
- Validation error scenarios (empty command, too long)

### Integration Points

#### Backend API

The backend already supports `validation_commands`:

- `POST /api/v1/projects` - Accepts `validationCommands: string[]` in request body
- `PUT /api/v1/projects/:id` - Accepts `validationCommands: string[] | null` in request body
- Response includes `validationCommands: string[]` in the project object

#### Shared Types

Already defined in `packages/shared/src/project/types.ts`:

- `ProjectValidationCommands` type
- `projectValidationCommandsSchema` for validation
- `normalizeProjectValidationCommands` helper
- `parseProjectValidationCommands` helper

## Implementation Steps

1. [ ] Update `projectFormSchema` in `project-form.tsx` to include validation for `validationCommands`
2. [ ] Update `ProjectFormValues` type and `projectToFormValues` helper
3. [ ] Create `ValidationCommandsField` component with add/edit/delete functionality
4. [ ] Integrate the new field into the form JSX between MCP config and action buttons
5. [ ] Update form submission handlers to include `validationCommands` in API payloads
6. [ ] Update Storybook stories with validation commands data and interaction tests
7. [ ] Run `pnpm type-check` and verify no type errors
8. [ ] Run `pnpm build` and verify successful build
9. [ ] Run `pnpm test` and verify tests pass
10. [ ] Run Storybook tests to verify component renders correctly

## Review Checklist

Before marking complete, verify:

- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] Storybook tests pass (`pnpm --filter @harness-kanban/web test:storybook`)
- [ ] UI follows existing patterns in the project form
- [ ] Form validation works correctly (empty commands, max length)
- [ ] Both create and update modes properly handle validation commands
- [ ] No Chinese text in code or comments
- [ ] Component structure aligns with backend API interfaces

## Notes

- The backend already has full CRUD support for `validation_commands`
- The shared types package already exports all necessary validation schemas and types
- The UI should be consistent with the existing project form design (spacing, typography, colors)
- Consider accessibility: keyboard navigation, aria labels for buttons, screen reader support
- The `previewCommands` field was previously removed from the UI per story assertions - validation commands is a separate feature that should be added
