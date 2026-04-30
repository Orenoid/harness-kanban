import { useMemo, useState } from 'react'

import { useIssuePropertyMetas } from '@/property/hooks/use-issue-property-metas'
import { PropertyValueType } from '@/property/types/property-types'
import { ActivityType } from '@repo/shared/issue/constants'
import { Activity, Comment } from '@repo/shared/issue/types'
import { PropertyType, SystemPropertyId } from '@repo/shared/property/constants'
import { Issue } from '@repo/shared/property/types'
import { StoryLayout } from '../../../.storybook/components'
import {
  createIssueActivitiesHandler,
  createIssueCommentHandler,
  createIssueCommentsHandler,
  createIssueHandler,
  createIssuesHandler,
  createStatusActionsHandler,
  createSubscribeIssueHandler,
  createUnsubscribeIssueHandler,
  createUpdateIssueHandler,
  createUsersHandler,
} from '../../../.storybook/msw'
import { convertIssueToRow } from '../utils/transform'
import { DetailPageView } from './detail-page'
import type { Meta, StoryObj } from '@storybook/nextjs'

const issueId = 482
const baseTime = Date.parse('2026-04-06T09:00:00Z')
const workerPullRequestUrl = 'https://github.com/harness-kanban/harness-kanban/pull/219'

const tiptapDoc = (paragraphs: string[]) =>
  JSON.stringify({
    type: 'doc',
    content: paragraphs.map(text => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  })

const workflowIssue: Issue = {
  issueId,
  propertyValues: [
    { propertyId: SystemPropertyId.ID, value: issueId },
    { propertyId: SystemPropertyId.TITLE, value: 'Add workspace-scoped API key rotation for coding agents' },
    { propertyId: SystemPropertyId.STATUS, value: 'completed' },
    { propertyId: SystemPropertyId.PRIORITY, value: 'urgent' },
    { propertyId: SystemPropertyId.PROJECT, value: 'project-1' },
    { propertyId: SystemPropertyId.ASSIGNEE, value: 'user-2' },
    { propertyId: SystemPropertyId.REPORTER, value: 'user-2' },
    { propertyId: SystemPropertyId.CREATED_AT, value: baseTime },
    { propertyId: SystemPropertyId.UPDATED_AT, value: baseTime + 54 * 60 * 1000 },
    {
      propertyId: SystemPropertyId.DESCRIPTION,
      value: tiptapDoc([
        'Workspace maintainers need to rotate API keys used by long-running coding agents without restarting active queues.',
        'Acceptance criteria: add a rotation endpoint, keep existing workers alive until the next checkout, audit every rotation, and cover the worker queue path with tests.',
      ]),
    },
  ],
}

const createStatusActivity = (id: string, minutes: number, createdBy: string, statusId: string): Activity => ({
  id,
  issueId,
  type: ActivityType.SET_PROPERTY_VALUE,
  createdBy,
  createdAt: baseTime + minutes * 60 * 1000,
  updatedAt: baseTime + minutes * 60 * 1000,
  payload: {
    userId: createdBy,
    propertyId: SystemPropertyId.STATUS,
    propertyType: PropertyType.STATUS,
    propertyName: 'Status',
    newValue: statusId,
  },
})

const createAssigneeActivity = (id: string, minutes: number, createdBy: string, assigneeId: string): Activity => ({
  id,
  issueId,
  type: ActivityType.SET_PROPERTY_VALUE,
  createdBy,
  createdAt: baseTime + minutes * 60 * 1000,
  updatedAt: baseTime + minutes * 60 * 1000,
  payload: {
    userId: createdBy,
    propertyId: SystemPropertyId.ASSIGNEE,
    propertyType: PropertyType.USER,
    propertyName: 'Assignee',
    newValue: assigneeId,
  },
})

const markdownComment = (paragraphs: string[]) => paragraphs.join('\n\n')

const createComment = (id: string, minutes: number, createdBy: string, paragraphs: string[]): Comment => ({
  id,
  issueId,
  content: markdownComment(paragraphs),
  createdBy,
  parentId: null,
  createdAt: baseTime + minutes * 60 * 1000,
  updatedAt: baseTime + minutes * 60 * 1000,
  subComments: [],
})

const planComment = createComment('comment-plan', 12, 'code-bot', [
  `Opened a draft PR for review: ${workerPullRequestUrl}`,
  [
    'Planning workflow complete:',
    '- inspected auth config loading',
    '- added a workspace-scoped rotation service to the plan',
    '- kept the worker provider interface unchanged',
    '',
    'Proposed validation: `pnpm type-check`, `pnpm test`, `pnpm build`.',
  ].join('\n'),
])

const planChangeRequestComment = createComment('comment-plan-change-request', 18, 'user-2', [
  'I left some comments on the PR about the token refresh boundary. Please also make sure the issue-side audit log clearly shows who triggered each rotation and whether existing queued workers keep their current token until checkout.',
])

const revisedPlanComment = createComment('comment-revised-plan', 23, 'code-bot', [
  `Updated PR: ${workerPullRequestUrl}`,
  'Updated the plan to include the PR review comments and the issue feedback: token refresh stays scoped to checkout, the audit log records the triggering user, and queued workers keep their current token until the next checkout.',
])

const planReviewComment = createComment('comment-plan-review', 29, 'user-2', [
  'Plan approved. Keep the audit record write in the API transaction and add one regression test for workers already claimed by the queue.',
])

const implementationComment = createComment('comment-implementation', 42, 'code-bot', [
  `Implementation PR: ${workerPullRequestUrl}`,
  [
    'Implementation workflow complete:',
    '- added rotation API',
    '- persisted audit records',
    '- updated worker checkout token refresh',
    '- added service/unit coverage',
    '',
    'Validation passed: `pnpm type-check`, `pnpm test`, `pnpm build`.',
  ].join('\n'),
])

const reviewComment = createComment('comment-review', 49, 'user-2', [
  'Reviewed the implementation PR. Token refresh behavior matches the approved plan and the queue regression test covers the long-running worker path.',
])

const workflowActivities: Activity[] = [
  {
    id: 'activity-created',
    issueId,
    type: ActivityType.CREATE_ISSUE,
    createdBy: 'user-2',
    createdAt: baseTime,
    updatedAt: baseTime,
    payload: { userId: 'user-2' },
  },
  createStatusActivity('activity-queued', 3, 'user-2', 'queued'),
  createStatusActivity('activity-planning', 5, 'code-bot', 'planning'),
  {
    id: 'activity-plan-comment',
    issueId,
    type: ActivityType.COMMENT,
    payload: planComment,
    createdBy: 'code-bot',
    createdAt: planComment.createdAt,
    updatedAt: planComment.updatedAt,
  },
  createStatusActivity('activity-plan-review', 14, 'code-bot', 'plan_in_review'),
  createAssigneeActivity('activity-plan-review-assignee', 15, 'code-bot', 'user-2'),
  {
    id: 'activity-plan-change-request-comment',
    issueId,
    type: ActivityType.COMMENT,
    payload: planChangeRequestComment,
    createdBy: 'user-2',
    createdAt: planChangeRequestComment.createdAt,
    updatedAt: planChangeRequestComment.updatedAt,
  },
  createStatusActivity('activity-plan-change-request', 20, 'user-2', 'planning'),
  createAssigneeActivity('activity-plan-change-request-assignee', 21, 'user-2', 'code-bot'),
  {
    id: 'activity-revised-plan-comment',
    issueId,
    type: ActivityType.COMMENT,
    payload: revisedPlanComment,
    createdBy: 'code-bot',
    createdAt: revisedPlanComment.createdAt,
    updatedAt: revisedPlanComment.updatedAt,
  },
  createStatusActivity('activity-revised-plan-review', 25, 'code-bot', 'plan_in_review'),
  createAssigneeActivity('activity-revised-plan-review-assignee', 26, 'code-bot', 'user-2'),
  {
    id: 'activity-plan-review-comment',
    issueId,
    type: ActivityType.COMMENT,
    payload: planReviewComment,
    createdBy: 'user-2',
    createdAt: planReviewComment.createdAt,
    updatedAt: planReviewComment.updatedAt,
  },
  createStatusActivity('activity-in-progress', 31, 'user-2', 'in_progress'),
  createAssigneeActivity('activity-in-progress-assignee', 32, 'user-2', 'code-bot'),
  {
    id: 'activity-implementation-comment',
    issueId,
    type: ActivityType.COMMENT,
    payload: implementationComment,
    createdBy: 'code-bot',
    createdAt: implementationComment.createdAt,
    updatedAt: implementationComment.updatedAt,
  },
  createStatusActivity('activity-in-review', 45, 'code-bot', 'in_review'),
  createAssigneeActivity('activity-in-review-assignee', 46, 'code-bot', 'user-2'),
  {
    id: 'activity-review-comment',
    issueId,
    type: ActivityType.COMMENT,
    payload: reviewComment,
    createdBy: 'user-2',
    createdAt: reviewComment.createdAt,
    updatedAt: reviewComment.updatedAt,
  },
  createStatusActivity('activity-completed', 53, 'user-2', 'completed'),
  createAssigneeActivity('activity-completed-assignee', 54, 'user-2', 'user-2'),
]

const workflowComments = [
  planComment,
  planChangeRequestComment,
  revisedPlanComment,
  planReviewComment,
  implementationComment,
  reviewComment,
]

const IssueDetailPageStory = () => {
  const fields = useIssuePropertyMetas()
  const [editedValues, setEditedValues] = useState<Record<string, unknown>>({})
  const row = useMemo(() => convertIssueToRow(workflowIssue), [])

  const getValue = (propertyId: string) =>
    (propertyId in editedValues ? editedValues[propertyId] : row[propertyId]) as PropertyValueType

  const getOnChangeHandler = (propertyId: string) => (value: unknown) => {
    setEditedValues(prev => ({ ...prev, [propertyId]: value }))
  }

  const setValues = (updates: Record<string, unknown>) => {
    setEditedValues(prev => ({ ...prev, ...updates }))
  }

  return (
    <DetailPageView
      issueId={issueId}
      fields={fields}
      row={row}
      editedValues={editedValues}
      navigationContext={{ source: 'project', projectId: 'project-1', projectName: 'Project Alpha' }}
      getValue={getValue}
      getOnChangeHandler={getOnChangeHandler}
      setValues={setValues}
    />
  )
}

const meta: Meta<typeof IssueDetailPageStory> = {
  component: IssueDetailPageStory,
  parameters: {
    layout: 'fullscreen',
    msw: {
      handlers: {
        issues: (() => {
          const issues = [workflowIssue]
          const activities = [...workflowActivities]
          const subscriberIds = ['user-2', 'code-bot']
          const comments = [...workflowComments]

          return [
            createIssuesHandler({ issues }),
            createIssueHandler(issues),
            createUpdateIssueHandler({ issues }),
            createStatusActionsHandler(issues),
            createIssueActivitiesHandler({ activities, subscriberIds }),
            createSubscribeIssueHandler(subscriberIds),
            createUnsubscribeIssueHandler(subscriberIds),
            createIssueCommentsHandler(comments),
            createIssueCommentHandler(comments, activities),
          ]
        })(),
        users: [
          createUsersHandler([
            { id: 'user-2', username: 'Noah Patel', imageUrl: '', hasImage: false },
            { id: 'code-bot', username: 'CodeBot', imageUrl: '/images/bot-avatar.svg', hasImage: true },
          ]),
        ],
      },
    },
  },
  decorators: [
    Story => (
      <StoryLayout pathname="/issues">
        <Story />
      </StoryLayout>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof meta>

const waitForCondition = async (predicate: () => boolean, timeoutMs = 2500, intervalMs = 50) => {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  throw new Error('Timed out waiting for condition.')
}

export const HarnessWorkerWorkflow: Story = {
  play: async ({ canvasElement }) => {
    await waitForCondition(() => canvasElement.textContent?.includes('Add workspace-scoped API key rotation') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('Planning workflow complete') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('I left some comments on the PR') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('issue-side audit log') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('Updated the plan') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('Implementation workflow complete') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('Noah Patel') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes(workerPullRequestUrl) ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('CodeBot') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('Validation passed') ?? false)
    await waitForCondition(() => canvasElement.textContent?.includes('Completed') ?? false)
    await waitForCondition(() => Boolean(canvasElement.querySelector('textarea[aria-label="Write a comment"]')))
    await waitForCondition(
      () => canvasElement.querySelector('[data-activity-section-title]')?.textContent === 'Activity',
    )

    if (canvasElement.querySelector('.markdown-editor')) {
      throw new Error('Comment composer should use the plain markdown input.')
    }

    if (canvasElement.querySelector('[data-activity-list-header]')) {
      throw new Error('Activity list should not render a second Activity header.')
    }

    const activitySection = canvasElement.querySelector('section[aria-labelledby="issue-activity-title"]')
    if (!activitySection) {
      throw new Error('Expected activity composer section to render.')
    }

    if (getComputedStyle(activitySection).borderTopWidth !== '0px') {
      throw new Error('Activity composer section should not render an outer box.')
    }

    const commentItem = canvasElement.querySelector('[data-comment-item]')
    if (!commentItem) {
      throw new Error('Expected rendered comment item to appear in the activity list.')
    }

    if (getComputedStyle(commentItem).borderTopWidth !== '0px') {
      throw new Error('Rendered comment item should not render a card border.')
    }

    if (getComputedStyle(commentItem).backgroundColor === 'rgba(0, 0, 0, 0)') {
      throw new Error('Rendered comment item should use a subtle background.')
    }
  },
}
