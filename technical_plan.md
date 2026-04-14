# Technical Plan

## Status

**Phase:** Planning

## Requirements Summary

Completely rewrite the comment input and rendering components to support markdown. The rendering component must render markdown content. The input component should ideally provide WYSIWYG editing; if not, the placeholder must inform users that markdown syntax is supported. Existing comments in the database should be treated as plain text without migration.

## Technical Design

### 1. Markdown Rendering Component (`MarkdownRenderer`)

- **Location:** `apps/web/src/components/core/markdown-renderer.tsx`
- **Library:** Install and use `react-markdown` with `remark-gfm` for GitHub-flavored markdown (tables, task lists, strikethrough, etc.).
- **Syntax Highlighting:** Integrate `shiki` (already installed) for code block highlighting.
- **Styling:** Apply Tailwind `prose` and `prose-slate dark:prose-invert` classes for consistent typography.
- **Fallback Behavior:** Old comments stored as Tiptap JSON strings are rendered as plain text per the requirement.
- **Security:** Ensure `react-markdown` is configured to sanitize/disallow dangerous HTML.

### 2. Markdown Editor Component (`MarkdownEditor`)

- **Location:** `apps/web/src/components/core/markdown-editor.tsx`
- **Base:** Reuse Tiptap to provide a WYSIWYG experience (slash commands, lists, headings, code blocks, image paste/upload).
- **Serialization:** Use `prosemirror-markdown` (already installed) or add `tiptap-markdown` to convert between Tiptap's document tree and markdown strings on save/load.
- **API:** Expose an imperative handle (`MarkdownEditorHandle`) with `getValue()`, `setValue()`, `clear()`, and `focusEnd()` to match the current `TiptapEditorHandle` contract.
- **Placeholder:** Set placeholder text to `"Write a comment... Markdown syntax is supported"`.
- **Image Upload:** Retain the existing base64 image paste-and-upload flow.

### 3. Comment Property Parser Update

- **Location:** `apps/web/src/issue/components/comment/comment-property/parser.ts`
- **New Format:** Introduce a lightweight wrapper format that stores markdown content alongside property metadata:
  ```json
  {
    "content": "# Markdown string",
    "attr": { "data": { "propertyId": "value" } }
  }
  ```
- **Compatibility:** Update `parseCommentContent` to detect and parse both the old Tiptap JSON shape and the new markdown-wrapped shape. Update `stringifyCommentContent` to emit the new format.

### 4. Comment Form Rewrite

- **`CommentForm`** (`apps/web/src/issue/components/comment/comment-form.tsx`):
  - Replace `TiptapEditor` with `MarkdownEditor`.
  - Store and submit comment content as a markdown string (or the new wrapped format when properties are absent).
- **`EnhancedCommentForm`** (`apps/web/src/issue/components/comment/enhanced-comment-form.tsx`):
  - Replace `TiptapEditor` with `MarkdownEditor`.
  - Keep the tabbed property UI but wrap the markdown output with property metadata using the updated parser.

### 5. Comment Item Rewrite

- **`CommentItem`** (`apps/web/src/issue/components/comment/comment-item.tsx`):
  - Replace read-only `TiptapViewer` with `MarkdownRenderer`.
  - Replace edit mode `TiptapEditor` with `MarkdownEditor`.
  - Preserve existing behaviors: edit/save/cancel, delete confirmation, property viewer/form rendering, and themed comment styling.

### 6. Stories and Tests

- **Stories:**
  - `markdown-renderer.stories.tsx` — cover empty, plain text, headings, lists, code blocks, and table states.
  - `markdown-editor.stories.tsx` — cover default, filled, and disabled states.
- **Tests:**
  - Unit tests for `parseCommentContent` and `stringifyCommentContent` covering old JSON, new markdown-wrapped JSON, and plain text fallback.
  - Component tests for `MarkdownRenderer` verifying correct DOM output for common markdown syntax.

## Implementation Steps

1. [ ] Add `react-markdown` and `remark-gfm` to `apps/web` dependencies.
2. [ ] Create `MarkdownRenderer` component with `shiki` highlighting and `prose` styling.
3. [ ] Create `MarkdownEditor` component based on Tiptap with markdown serialization.
4. [ ] Update `comment-property/parser.ts` to support the new markdown-wrapped format.
5. [ ] Rewrite `CommentForm` to use `MarkdownEditor`.
6. [ ] Rewrite `EnhancedCommentForm` to use `MarkdownEditor` with property metadata.
7. [ ] Rewrite `CommentItem` to use `MarkdownRenderer` and `MarkdownEditor`.
8. [ ] Add Storybook stories for `MarkdownRenderer` and `MarkdownEditor`.
9. [ ] Add unit tests for parser utilities and rendering component.
10. [ ] Run `pnpm type-check`, `pnpm build`, and `pnpm test` to verify correctness.

## Review Checklist

Before marking complete, verify:

- [ ] `pnpm type-check` passes across the monorepo.
- [ ] `pnpm build` passes in the root project.
- [ ] `pnpm test` passes (unit tests).
- [ ] Storybook stories render correctly and `pnpm --filter @harness-kanban/web test:storybook` passes.
- [ ] No Chinese text appears in code or comments.
- [ ] New functionality is manually verified in the running application.

## Notes

- `prosemirror-markdown` is already installed, which simplifies building a custom markdown serializer for Tiptap. If implementation becomes unwieldy, consider adding the `tiptap-markdown` extension as an alternative.
- The existing comment property system (tabs, themes, validation) will be preserved and adapted to the new content format rather than removed.
- Old comments are intentionally not migrated; they will display as plain text strings.
