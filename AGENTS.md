# Repository Guidelines

## Project Introduction

Harness Kanban is an AI-powered issue tracking system - a modern, AI-native alternative to traditional issue trackers. It combines traditional issue management with an AI agent system that understands natural language commands to manage issues, add comments, track todos, and interact with users through an intelligent chat interface.

### Key Features

- **AI Agent System**: Natural language chat interface with 20+ tools for issue management, comments, subscriptions, and personal todos
- **Harness Kanban Orchestration**: An in-progress `harness-kanban` backend for queueing and routing work to long-running coding workers
- **Flexible Issue Management**: Customizable property system allowing custom fields on issues with various types and validation
- **Multi-Provider AI Support**: Works with OpenAI, Anthropic, Google, Groq, and 20+ other LLM providers via Vercel AI SDK
- **Real-time Streaming**: Real-time AI responses with tool execution and UI rendering
- **Notification System**: Internal inbox notifications with an extensible channel abstraction for future delivery channels

### Technology Stack

**Backend**: NestJS 11, PostgreSQL with Prisma ORM, Better Auth, Vercel AI SDK, LangChain/LangGraph, ChromaDB
**Frontend**: Next.js 15 (App Router), React 18, Tailwind CSS 4, shadcn, Radix UI, TanStack Query
**Monorepo**: pnpm workspaces, Turborepo, TypeScript throughout

## Project Structure

> **Note**: To avoid outdated or incorrect project structure information, AI should always explore the current codebase to understand the latest structure. Recommended approach:
>
> 1. First browse the overall structure and key files to get a general understanding
> 2. Then dive deeper into specific modules related to the user's request
>
> This ensures working with the most up-to-date codebase state rather than relying on potentially stale documentation.

## Review Rules

### Commands that must run and pass

<!-- Each command should only be run after the previous one has completed without errors. -->

- `pnpm type-check` must pass
- `pnpm build` must pass in root project
- `pnpm test` must pass, unless specified by users that some tests failure can be ignored temporarily.
- For frontend changes, run `pnpm --filter @harness-kanban/web test:storybook`. Before running, use `pnpm --filter @harness-kanban/web storybook-alive` to check if Storybook is already running. If not, start it first with `pnpm --filter @harness-kanban/web storybook`.

### Code review

- **[IMPORTANT]** ALWAYS use accessible tools (e.g., chrome-devtools MCP, bash, etc.) to verify the new function actually works as expected !!! Passing unit tests doesn't guarantee the system works correctly !!! You MUST personally verify in the product that the modified features work correctly !!!
- **[IMPORTANT]** ALWAYS use accessible tools (e.g., chrome-devtools MCP, bash, etc.) to verify the new function actually works as expected !!! Passing unit tests doesn't guarantee the system works correctly !!! You MUST personally verify in the product that the modified features work correctly !!!
- **[IMPORTANT]** ALWAYS use accessible tools (e.g., chrome-devtools MCP, bash, etc.) to verify the new function actually works as expected !!! Passing unit tests doesn't guarantee the system works correctly !!! You MUST personally verify in the product that the modified features work correctly !!!
- for frontend changes, verify that hooks and Storybook mock structures align with backend API interfaces, including field names and value validity
- Backend main workflows should have E2E tests, branch logic should have unit test coverage
- New frontend stories should have proper component structure tests
- ensure there are no Chinese text in code or comments

## Development Convention and Guidance

### Available Scripts

#### Root Monorepo (`package.json`)

| Command            | Description                                        |
| ------------------ | -------------------------------------------------- |
| `pnpm build`       | Build all apps and packages using Turbo            |
| `pnpm dev`         | Start development mode for all apps using Turbo    |
| `pnpm start`       | Start web and API production servers using Turbo   |
| `pnpm lint`        | Run linting across all packages using Turbo        |
| `pnpm format`      | Format code across all packages using Turbo        |
| `pnpm test`        | Run unit tests across all packages using Turbo     |
| `pnpm test:e2e`    | Run E2E tests (migrates DB first using `.env.e2e`) |
| `pnpm db:generate` | Generate Prisma client                             |
| `pnpm db:migrate`  | Run database migrations                            |
| `pnpm db:studio`   | Open Prisma Studio                                 |
| `pnpm db:push`     | Push schema changes to database                    |
| `pnpm prepare`     | Run Husky git hooks setup                          |

#### API Server (`apps/api-server`)

| Command             | Description                               |
| ------------------- | ----------------------------------------- |
| `pnpm build`        | Clean dist and build NestJS application   |
| `pnpm dev`          | Start NestJS in watch mode                |
| `pnpm start`        | Run the built NestJS application          |
| `pnpm dev:worker`   | Start the harness worker in watch mode    |
| `pnpm start:worker` | Run the worker production build from dist |
| `pnpm lint`         | Run ESLint with auto-fix                  |
| `pnpm format`       | Format source files with Prettier         |
| `pnpm type-check`   | Type-check without emitting               |
| `pnpm test`         | Run Jest tests                            |
| `pnpm test:e2e`     | Run Jest E2E tests with `.env.e2e`        |

#### Web App (`apps/web`)

| Command                | Description                                        |
| ---------------------- | -------------------------------------------------- |
| `pnpm dev`             | Start Next.js development server using `.next`     |
| `pnpm start`           | Start Next.js production server from `.next-build` |
| `pnpm build`           | Build Next.js application into `.next-build`       |
| `pnpm build:lib`       | Build library using TypeScript                     |
| `pnpm lint`            | Run ESLint with auto-fix                           |
| `pnpm format`          | Format source files with Prettier                  |
| `pnpm type-check`      | Type-check without emitting                        |
| `pnpm test`            | Run Vitest tests                                   |
| `pnpm test:e2e`        | Run Playwright E2E tests                           |
| `pnpm test:storybook`  | Run Storybook test-runner                          |
| `pnpm storybook`       | Start Storybook dev server on port 6006            |
| `pnpm build-storybook` | Build Storybook for production                     |

#### Database Package (`packages/database`)

| Command            | Description                                   |
| ------------------ | --------------------------------------------- |
| `pnpm build`       | Generate Prisma client and compile TypeScript |
| `pnpm prebuild`    | Generate Prisma client (pre-build hook)       |
| `pnpm dev`         | Watch mode TypeScript compilation             |
| `pnpm predev`      | Generate Prisma client (pre-dev hook)         |
| `pnpm check-types` | Type-check without emitting                   |
| `pnpm db:generate` | Generate Prisma client                        |
| `pnpm db:migrate`  | Run database migrations (skip generate)       |
| `pnpm db:deploy`   | Deploy migrations to production               |
| `pnpm db:studio`   | Open Prisma Studio                            |

#### Shared Package (`packages/shared`)

| Command           | Description                    |
| ----------------- | ------------------------------ |
| `pnpm build`      | Build using tsup               |
| `pnpm dev`        | Build in watch mode using tsup |
| `pnpm type-check` | Type-check without emitting    |
| `pnpm lint`       | Run ESLint on src/             |

### Commit Message Convention

Use [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages.

Format:

```text
<type>(<scope>): <description>
```

Common `type` values:

- `feat`: a new feature
- `fix`: a bug fix
- `refactor`: a code change that neither fixes a bug nor adds a feature
- `docs`: documentation only changes
- `test`: adding or updating tests
- `chore`: maintenance work (build tooling, deps, config, etc.)

Examples:

```text
feat(api): add issue assignment endpoint
fix(web): handle empty state in kanban column
docs(readme): update local development steps
```

### Branch Naming Convention

Use branch names that are clear, searchable, and aligned with the change type.

Format:

```text
<type>/<scope>-<short-description>
```

Branch naming rules:

- Use lowercase letters and hyphens only
- Keep the description short and specific
- Match `type` with commit intent when possible

Common `type` values:

- `feat`: new feature work
- `fix`: bug fixes
- `refactor`: non-functional code restructuring
- `docs`: documentation updates
- `test`: test-related work
- `chore`: tooling or maintenance tasks

Examples:

```text
feat/api-issue-assignment
fix/web-kanban-empty-state
docs/readme-dev-setup
chore/worker-deps-update
```

### Testing

<!-- some convention and tips on tests design and implementation -->

#### E2E Testing

Use `loginUser(app, email, password)` from `test/utils/auth-helper.ts` to get an authenticated supertest agent with session cookies. The helper handles the sign-in API call and returns an agent ready for authenticated requests.

```typescript
import { loginUser, SupertestAgent } from './utils/auth-helper'

const agent: SupertestAgent = await loginUser(app, 'user@example.com', 'password')
await agent.get('/api/protected').expect(200)
```

Refer to existing tests for complete working examples.

#### AI SDK Testing

Use `MockLanguageModelV3` from `ai/test` for unit testing AI tools. See [AI SDK Testing Docs](https://sdk.vercel.ai/docs/ai-sdk-core/testing).

```typescript
import { generateText } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

const result = await generateText({
  model: new MockLanguageModelV3({ doGenerate: async () => ({ ... }) }),
  tools,
  prompt: 'test',
})
```

Note: `MockLanguageModelV3` simulates model responses but does not auto-execute tools. To test tool logic directly, call `tools.<toolName>.execute({})` with mocked services.

### **IMPORTANT: Follow Existing Patterns**

> **When creating new components, APIs, hooks, or pages, always reference existing patterns in the codebase first.**

Before implementing new features:

- Search for similar existing implementations in the same directory or feature area
- Study the patterns used for component structure, naming conventions, and file organization
- Follow established conventions for error handling, data fetching, and state management
- Use existing utility functions and shared components rather than creating new ones
- Maintain consistency with the current architecture and design patterns

This ensures code consistency, reduces bugs, and makes the codebase easier to maintain.

### Backend Convention

#### API Response Format

All API responses use a wrapped structure defined in `common/responses/api-response.ts`:

```typescript
type ApiResponse<T> = { success: true; data: T; error: null } | { success: false; data: null; error: ApiError }

// Use makeSuccessResponse(data) and makeErrorResponse(error) helpers
```

### Frontend Convention

#### Storybook Stories Location

Story files should be created in the same directory as the component they document, not in a separate stories folder.

```
components/
├── my-component.tsx
└── my-component.stories.tsx  // Story in same directory
```

This co-location pattern makes it easier to find and maintain stories alongside their components.

#### Storybook Best Practices

When constructing stories, prefer using `args` over custom `render` functions. This approach allows Storybook's controls addon to work properly and makes stories more maintainable.

```typescript
// Good: Using args
export const Default: Story = {
  args: {
    title: 'Hello',
    isOpen: true,
  },
}

// Avoid: Using render functions when not necessary
export const Default: Story = {
  render: () => <MyComponent title="Hello" isOpen={true} />,
}
```

Use `render` functions only when you need to wrap the component with providers or add interactive behavior.

For components that perform data querying or mutations, use a container/presentational split in the same file: export the container with the existing component name for app usage, and export a secondary `*View` presentational component for Storybook.

#### Stories Design

When designing stories for a component, analyze all possible states the component can have and create a story for each state. This ensures comprehensive visual coverage and testing of the component's behavior.

- **Props-driven states**: Use `args` to control states that are exposed via props (e.g., `isOpen`, `variant`, `disabled`)
- **Internal states**: Use Storybook's `play` function to trigger states that require user interaction (e.g., hover effects, form validation after submit, loading states after button click)

```typescript
// Props-driven state
export const Disabled: Story = {
  args: {
    disabled: true,
    label: 'Submit',
  },
}

// Interaction-triggered internal state
export const ValidationError: Story = {
  args: {
    label: 'Email',
  },
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox')
    await userEvent.type(input, 'invalid-email')
    await userEvent.tab() // Trigger blur/validation
    await expect(canvas.getByText('Invalid email format')).toBeInTheDocument()
  },
}
```

#### Storybook Play Function

Each story should use the `play` function to verify that the rendered component structure matches expectations. This ensures components render correctly and provides automated UI testing within Storybook.

```typescript
export const FilledForm: Story = {
  play: async ({ canvas, userEvent }) => {
    // 👇 Simulate interactions with the component
    await userEvent.type(canvas.getByTestId('email'), 'email@provider.com')

    await userEvent.type(canvas.getByTestId('password'), 'a-random-password')

    // See https://storybook.js.org/docs/essentials/actions#automatically-matching-args to learn how to setup logging in the Actions panel
    await userEvent.click(canvas.getByRole('button'))

    // 👇 Assert DOM structure
    await expect(
      canvas.getByText('Everything is perfect. Your account is ready and we should probably get you started!'),
    ).toBeInTheDocument()
  },
}
```

The `play` function allows you to:

- Simulate user interactions (clicks, typing, etc.)
- Assert DOM structure and content
- Verify component behavior after interactions

Check official document for referrence.

#### Storybook Development

Access Storybook at http://localhost:6006/ when running `pnpm storybook` from the `apps/web` directory.

Storybook MSW mocks are organized in `apps/web/.storybook/msw`, with one module per API and a shared default handler bundle used by preview.

When writing Storybook MSW handlers in `.storybook/msw`, import `http` from `msw/core/http` and return `Response.json(...)` in handlers. Avoid relying on root `msw` exports for `http` in Storybook runtime, or stories may fail with `Cannot read properties of undefined (reading 'get')`.

When debugging UI issues in Storybook:

- Prioritize using DevTools to get specific CSS-related data (computed styles, layout metrics, element properties)
- Use screenshots only as supplementary context to understand the visual state
- DevTools provides precise measurements and style information that screenshots cannot capture

#### Next.js Build Output Isolation

`apps/web` intentionally separates Next.js output directories by command to avoid local workflow conflicts:

- `pnpm dev` writes to `.next`
- `pnpm build` and `pnpm start` use `.next-build`

Keep this split when changing scripts or `next.config.mjs`, otherwise running `pnpm build` while `pnpm dev` is active can break the dev server with corrupted runtime artifacts.

#### Layout Sync Between App and Storybook

When modifying `apps/web/src/app/layout.tsx`, always check if `.storybook/components/StoryLayout.tsx` needs corresponding updates. The `StoryLayout` component mirrors the app layout structure for page-level stories, and they must stay in sync for consistent rendering behavior.

### Others

#### Docker Deployment

The root `docker-compose.yml` can run PostgreSQL, MinIO, the API server, the web app, and the harness worker together.

- Compose services read their environment from the service-specific files under `apps/`.
- `api`, `web`, and `worker` pull prebuilt images from GHCR using the repository's published `latest` tags.
- The worker container needs a reachable Docker socket mount so DevPod can create host-managed workspaces.
- If web uploads need to be opened from the browser, set `MINIO_PUBLIC_BASE_URL` to a browser-reachable URL instead of an internal container hostname.

#### Agent Tool Implementation

See [`contributing/tool-implementation.md`](./contributing/tool-implementation.md) for the complete guide on implementing a new Tool.

### Documentation Maintenance

After making code changes, always review this documentation to check if any sections need updates to reflect the new code state. This includes:

- Updating script commands if build/development processes change
- Adding new patterns or conventions introduced in the code
- Updating project descriptions
- Adding documentation for new tools or workflows

Keeping this documentation synchronized with the codebase ensures accurate guidance for future development work.
