# Technical Plan

## Status

**Phase:** Planning

## Requirements Summary

Update the repository README by adding the title of the OpenAI article at `https://openai.com/index/harness-engineering/`.
The implementation must first use Chrome DevTools MCP to retrieve and verify the article title from the live page.
If Chrome DevTools MCP is unavailable or cannot access the page content, stop implementation and report the blocker instead of making README changes.

## Technical Design

- Scope of change:
  - File: `README.md` (single-file documentation update).
  - New file in planning phase: `technical_plan.md`.
- Retrieval/validation flow:
  - Use Chrome DevTools MCP to navigate to the OpenAI URL and inspect the page title element (`<title>` or equivalent H1/title text).
  - Capture the exact title string and use that value as the source of truth.
- Documentation insertion approach:
  - Add one concise line in `README.md` that includes the verified article title and optionally the source link.
  - Keep formatting consistent with existing README style and avoid unrelated edits.
- Classes/functions/components/database/APIs:
  - No application classes/functions/components/database schema/API contract changes are expected.
  - Integration point is external page inspection via Chrome DevTools MCP only.
- Testing and verification plan:
  - Confirm the title was read through MCP (not copied from memory).
  - Validate README renders cleanly (Markdown structure intact).
  - Run required repository checks before final completion:
    - `pnpm type-check`
    - `pnpm build`
    - `pnpm test`
  - Frontend-specific Storybook checks are not required unless frontend code changes are introduced.
- Operational considerations:
  - External dependency: openai.com availability and MCP connectivity.
  - Failure handling: if MCP retrieval fails, halt and report issue status with failure reason and attempted step.

## Implementation Steps

1. [ ] Use Chrome DevTools MCP to open `https://openai.com/index/harness-engineering/` and extract the exact article title from page content.
2. [ ] Update `README.md` to include the extracted title in an appropriate section with minimal, style-consistent wording.
3. [ ] Run required checks, verify no unintended file changes, and prepare the final change summary (or blocker report if MCP failed).

## Review Checklist

Before marking complete, verify all items from the project's Review Rules in `AGENTS.md` or equivalent guidance.

- [ ] Validate functionality using accessible tools (Chrome DevTools MCP and/or terminal) rather than relying on tests alone.
- [ ] Run and pass `pnpm type-check`.
- [ ] Run and pass `pnpm build` at repository root.
- [ ] Run and pass `pnpm test`.
- [ ] For frontend changes only: verify Storybook availability with `pnpm --filter @harness-kanban/web storybook-alive`, start if needed, then run `pnpm --filter @harness-kanban/web test:storybook`.
- [ ] Ensure no Chinese text is introduced in code/comments/docs.

## Notes

- This issue is a documentation task with a hard dependency on Chrome DevTools MCP for source verification.
- If MCP cannot be used at execution time, expected behavior is to stop and report the blocker to the issue thread.
