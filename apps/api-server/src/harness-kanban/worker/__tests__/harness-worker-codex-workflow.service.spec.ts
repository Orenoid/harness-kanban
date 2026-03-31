import { PrismaService } from '@/database/prisma.service'
import { CommentService } from '@/issue/comment.service'
import { IssueService } from '@/issue/issue.service'
import { SystemBotId } from '@/user/constants/user.constants'
import { ConfigService } from '@nestjs/config'
import { CommonPropertyOperationType, SystemPropertyId } from '@repo/shared/property/constants'
import { HarnessWorkerCodexRunnerService } from '../harness-worker-codex-runner.service'
import { HarnessWorkerCodexWorkflowService } from '../harness-worker-codex-workflow.service'
import { HarnessWorkerGithubService } from '../harness-worker-github.service'

describe('HarnessWorkerCodexWorkflowService', () => {
  let service: HarnessWorkerCodexWorkflowService
  let prismaService: jest.Mocked<PrismaService>
  let configService: jest.Mocked<ConfigService>
  let issueService: jest.Mocked<IssueService>
  let commentService: jest.Mocked<CommentService>
  let githubService: jest.Mocked<HarnessWorkerGithubService>
  let codexRunnerService: jest.Mocked<HarnessWorkerCodexRunnerService>

  beforeEach(() => {
    prismaService = {
      client: {
        issue: {
          findUnique: jest.fn().mockResolvedValue({
            created_by: 'user-1',
            workspace_id: 'workspace-1',
          }),
        },
        property_single_value: {
          findFirst: jest.fn().mockResolvedValue({
            value: 'Planning workflow',
          }),
        },
      },
    } as unknown as jest.Mocked<PrismaService>

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'HARNESS_WORKER_CODEX_OUTPUT_REPAIR_ATTEMPTS') {
          return '1'
        }

        return undefined
      }),
    } as unknown as jest.Mocked<ConfigService>

    issueService = {
      getIssueById: jest.fn().mockResolvedValue({
        issueId: 101,
        propertyValues: [
          { propertyId: SystemPropertyId.TITLE, value: 'Planning workflow' },
          { propertyId: SystemPropertyId.DESCRIPTION, value: 'Draft a technical plan for the worker' },
          { propertyId: SystemPropertyId.STATUS, value: 'planning' },
          { propertyId: SystemPropertyId.PRIORITY, value: 'high' },
          { propertyId: SystemPropertyId.PROJECT, value: 'project-1' },
        ],
      }),
      updateIssue: jest.fn().mockResolvedValue({
        success: true,
        issueId: 101,
      }),
    } as unknown as jest.Mocked<IssueService>

    commentService = {
      queryComments: jest.fn().mockResolvedValue([
        {
          id: 'comment-1',
          issueId: 101,
          content: 'Please keep this limited to the planning phase.',
          createdBy: 'user-2',
          createdAt: Date.parse('2026-03-15T06:00:00.000Z'),
          updatedAt: Date.parse('2026-03-15T06:00:00.000Z'),
          subComments: [],
        },
      ]),
      createComment: jest.fn(),
    } as unknown as jest.Mocked<CommentService>

    githubService = {
      getPlanPullRequestContext: jest.fn().mockResolvedValue({
        pullRequest: {
          number: 17,
          url: 'https://github.com/harness-kanban/payments-api/pull/17',
          title: 'Technical plan for issue #101: Continuation workflow',
          body: 'Current plan body',
          baseBranch: 'main',
          headBranch: 'code-bot/issue-101-plan',
          state: 'open',
          isDraft: true,
        },
        reviews: [
          {
            id: 1,
            state: 'COMMENTED',
            body: 'Please tighten the implementation steps.',
            submittedAt: '2026-03-15T06:30:00.000Z',
            url: 'https://github.com/harness-kanban/payments-api/pull/17#pullrequestreview-1',
            userLogin: 'reviewer-1',
          },
        ],
        reviewComments: [
          {
            id: 2,
            body: 'Add test coverage notes here.',
            path: 'technical_plan.md',
            line: 12,
            side: 'RIGHT',
            createdAt: '2026-03-15T06:31:00.000Z',
            updatedAt: '2026-03-15T06:31:00.000Z',
            url: 'https://github.com/harness-kanban/payments-api/pull/17#discussion_r2',
            userLogin: 'reviewer-1',
          },
        ],
        issueComments: [],
      }),
      ensureDraftPullRequest: jest.fn().mockResolvedValue({
        number: 17,
        url: 'https://github.com/harness-kanban/payments-api/pull/17',
      }),
      ensureReadyForReviewPullRequest: jest.fn().mockResolvedValue({
        number: 22,
        url: 'https://github.com/harness-kanban/payments-api/pull/22',
      }),
      waitForImplementationPullRequestReadiness: jest.fn().mockResolvedValue({
        state: 'ready',
        summary: 'Pull request is ready for human review.',
        blockingReasons: [],
        context: {
          checksEnabled: true,
          combinedStatus: { state: 'success', statuses: [] },
          checkRuns: [],
          pullRequest: {
            number: 22,
            url: 'https://github.com/harness-kanban/payments-api/pull/22',
            title: 'Issue #101: Continuation workflow',
            body: null,
            baseBranch: 'main',
            headBranch: 'code-bot/issue-101',
            headSha: 'abc123',
            state: 'open',
            isDraft: false,
            mergeable: true,
            mergeableState: 'clean',
          },
          reviews: [],
          reviewComments: [],
          issueComments: [],
        },
      }),
      findImplementationPullRequestContext: jest.fn().mockResolvedValue(null),
      getImplementationPullRequestContext: jest.fn().mockResolvedValue({
        checksEnabled: true,
        combinedStatus: { state: 'success', statuses: [] },
        checkRuns: [],
        pullRequest: {
          number: 22,
          url: 'https://github.com/harness-kanban/payments-api/pull/22',
          title: 'Issue #101: Continuation workflow',
          body: null,
          baseBranch: 'main',
          headBranch: 'code-bot/issue-101',
          headSha: 'abc123',
          state: 'open',
          isDraft: false,
          mergeable: true,
          mergeableState: 'clean',
        },
        reviews: [],
        reviewComments: [
          {
            id: 3,
            body: 'Please rename this helper.',
            path: 'src/example.ts',
            line: 18,
            side: 'RIGHT',
            createdAt: '2026-03-15T06:31:00.000Z',
            updatedAt: '2026-03-15T06:31:00.000Z',
            url: 'https://github.com/harness-kanban/payments-api/pull/22#discussion_r3',
            userLogin: 'reviewer-2',
          },
        ],
        issueComments: [],
      }),
    } as unknown as jest.Mocked<HarnessWorkerGithubService>

    codexRunnerService = {
      resolveWorkspaceRoot: jest.fn().mockResolvedValue('/workspaces/harness-kanban-issue-101'),
      loadCodexThreadId: jest.fn().mockResolvedValue('thread-existing'),
      runCodexWithSchema: jest.fn(),
    } as unknown as jest.Mocked<HarnessWorkerCodexRunnerService>

    service = new HarnessWorkerCodexWorkflowService(
      prismaService,
      configService,
      issueService,
      commentService,
      githubService,
      codexRunnerService,
    )
  })

  it('starts planning by running Codex and submitting the technical plan PR for review', async () => {
    codexRunnerService.runCodexWithSchema.mockResolvedValue({
      threadId: 'thread-1',
      finalMessage:
        '{"action":"submit_plan","comment":"Please review the technical plan.","branch_name":"code-bot/issue-101-plan","pr_title":"Plan issue 101: Planning workflow","pr_body":"Create the technical plan and keep the rollout small."}',
    })

    await service.startPlanning({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(codexRunnerService.resolveWorkspaceRoot).toHaveBeenCalledWith(101)
    expect(codexRunnerService.runCodexWithSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 101,
        outputJsonSchema: expect.objectContaining({
          description: expect.stringContaining(
            'you must author the draft pull request title and body yourself and return them in this JSON response',
          ),
          required: ['action', 'comment', 'branch_name', 'pr_title', 'pr_body'],
          properties: expect.objectContaining({
            action: expect.objectContaining({
              description: expect.stringContaining("Use 'ask_questions' only when clarification is required"),
            }),
            comment: expect.objectContaining({
              description: expect.stringContaining("For 'ask_questions', write the clarification question"),
            }),
            branch_name: expect.objectContaining({
              description: expect.stringContaining("For 'submit_plan', return the technical plan branch name"),
            }),
            pr_title: expect.objectContaining({
              description: expect.stringContaining("For 'submit_plan', return the draft pull request title"),
            }),
            pr_body: expect.objectContaining({
              description: expect.stringContaining('Follow any user or repository pull request template when present'),
            }),
          }),
        }),
        repoRoot: '/workspaces/harness-kanban-issue-101',
        resumeThreadId: undefined,
        workflowLabel: 'planning',
        workspaceName: 'harness-kanban-issue-101',
      }),
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain('Planning workflow')
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'finish the planning task for the assigned issue',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'If the repository defines a branch naming convention in AGENTS.md, CLAUDE.md, or other repository guidance, follow that convention.',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'Otherwise, name the branch using the format <type>/<short-description>.',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'Even during the planning phase, name the branch for the actual change being planned or implemented, not as a generic plan branch.',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'use the same language the user used in the issue details and comments for both fields.',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'If the user or repository provides a pull request template, follow that template.',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'If the user or repository specifies a commit message convention, follow it. Otherwise, use Conventional Commits.',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'You must author the pull request title and body yourself',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'The system will place the pull request URL on the first line and then append your comment below it.',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      '"comment":"optional-issue-comment","branch_name":"your-branch-name","pr_title":"your-pr-title","pr_body":"your-pr-body"',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      "avoid '#<issueId>' because it can be confused with GitHub issue references; use a natural-language reference such as 'issue 123' instead.",
    )
    expect(githubService.ensureDraftPullRequest).toHaveBeenCalledWith({
      issueId: 101,
      workspaceId: 'workspace-1',
      branchName: 'code-bot/issue-101-plan',
      pullRequestTitle: 'Plan issue 101: Planning workflow',
      pullRequestBody: 'Create the technical plan and keep the rollout small.',
    })
    expect(issueService.updateIssue).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        userId: SystemBotId.CODE_BOT,
      },
      {
        issueId: 101,
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'plan_in_review' },
          },
          {
            propertyId: SystemPropertyId.ASSIGNEE,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'user-1' },
          },
        ],
      },
    )
    expect(commentService.createComment).toHaveBeenCalledWith(
      101,
      'https://github.com/harness-kanban/payments-api/pull/17\n\nPlease review the technical plan.',
      SystemBotId.CODE_BOT,
    )
  })

  it('repairs an invalid planning response by resuming the same Codex thread', async () => {
    codexRunnerService.runCodexWithSchema
      .mockResolvedValueOnce({
        threadId: 'thread-1',
        finalMessage: 'not valid json',
      })
      .mockResolvedValueOnce({
        threadId: 'thread-1',
        finalMessage: '{"action":"ask_questions","comment":"Which AWS account should this planning flow target?"}',
      })

    await service.startPlanning({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(codexRunnerService.runCodexWithSchema).toHaveBeenCalledTimes(2)
    expect(codexRunnerService.runCodexWithSchema.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        issueId: 101,
        repoRoot: '/workspaces/harness-kanban-issue-101',
        resumeThreadId: 'thread-1',
        workflowLabel: 'planning repair',
        workspaceName: 'harness-kanban-issue-101',
      }),
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[1]?.[0].prompt).toContain('Reply again with JSON only')
    expect(codexRunnerService.runCodexWithSchema.mock.calls[1]?.[0].prompt).toContain(
      '{"action":"ask_questions","comment":"..."}',
    )
    expect(commentService.createComment).toHaveBeenCalledWith(
      101,
      'Which AWS account should this planning flow target?',
      SystemBotId.CODE_BOT,
    )
  })

  it('builds a requestPlanChanges prompt with pull request review context', async () => {
    codexRunnerService.runCodexWithSchema.mockResolvedValue({
      threadId: 'thread-existing',
      finalMessage:
        '{"action":"submit_plan","comment":"I updated the plan based on review feedback.","branch_name":"code-bot/issue-101-plan","pr_title":"Plan issue 101: Planning workflow","pr_body":"Update the technical plan with the latest feedback."}',
    })

    await service.requestPlanChanges({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(githubService.getPlanPullRequestContext).toHaveBeenCalledWith({
      issueId: 101,
      workspaceId: 'workspace-1',
    })
    expect(codexRunnerService.loadCodexThreadId).toHaveBeenCalledWith(101)
    expect(codexRunnerService.runCodexWithSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 101,
        repoRoot: '/workspaces/harness-kanban-issue-101',
        resumeThreadId: 'thread-existing',
        workflowLabel: 'resume planning',
        workspaceName: 'harness-kanban-issue-101',
      }),
    )

    const prompt = codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt
    expect(prompt).toContain('revise an existing technical plan after review feedback')
    expect(prompt).toContain('Current technical plan pull request context (JSON):')
    expect(prompt).toContain('Please tighten the implementation steps.')
    expect(prompt).toContain('code-bot/issue-101-plan')
    expect(prompt).toContain('use the same language the user used in the issue details and comments for both fields.')
    expect(prompt).toContain('If the user or repository provides a pull request template, follow that template.')
    expect(prompt).toContain(
      'If the user or repository specifies a commit message convention, follow it. Otherwise, use Conventional Commits.',
    )
    expect(prompt).toContain('You must author the pull request title and body yourself')
    expect(prompt).toContain(
      '"comment":"optional-issue-comment","branch_name":"your-branch-name","pr_title":"your-pr-title","pr_body":"your-pr-body"',
    )
    expect(prompt).toContain(
      "avoid '#<issueId>' because it can be confused with GitHub issue references; use a natural-language reference such as 'issue 123' instead.",
    )
    expect(commentService.createComment).toHaveBeenCalledWith(
      101,
      'https://github.com/harness-kanban/payments-api/pull/17\n\nI updated the plan based on review feedback.',
      SystemBotId.CODE_BOT,
    )
  })

  it('resumes planning from clarification without loading PR context', async () => {
    codexRunnerService.runCodexWithSchema.mockResolvedValue({
      threadId: 'thread-existing',
      finalMessage: '{"action":"ask_questions","comment":"Which rollout constraints should the updated plan cover?"}',
    })

    await service.resumePlanning({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(githubService.getPlanPullRequestContext).not.toHaveBeenCalled()
    expect(codexRunnerService.loadCodexThreadId).toHaveBeenCalledWith(101)
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'continue technical planning after receiving new clarification from the user',
    )
    expect(issueService.updateIssue).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        userId: SystemBotId.CODE_BOT,
      },
      {
        issueId: 101,
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'needs_clarification' },
          },
          {
            propertyId: SystemPropertyId.ASSIGNEE,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'user-1' },
          },
        ],
      },
    )
    expect(commentService.createComment).toHaveBeenCalledWith(
      101,
      'Which rollout constraints should the updated plan cover?',
      SystemBotId.CODE_BOT,
    )
  })

  it('starts implementation by running Codex and moving the PR into review', async () => {
    codexRunnerService.runCodexWithSchema.mockResolvedValue({
      threadId: 'thread-existing',
      finalMessage:
        '{"action":"submit_for_review","comment":"Please review the implementation changes.","branch_name":"code-bot/issue-101","pr_title":"feat(worker): implement planning workflow","pr_body":"## Summary\\n- implement the approved workflow\\n\\n## Testing\\n- pnpm test"}',
    })

    await service.startImplementation({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(githubService.getPlanPullRequestContext).toHaveBeenCalledWith({
      issueId: 101,
      workspaceId: 'workspace-1',
    })
    expect(codexRunnerService.loadCodexThreadId).toHaveBeenCalledWith(101)
    expect(codexRunnerService.runCodexWithSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 101,
        repoRoot: '/workspaces/harness-kanban-issue-101',
        resumeThreadId: 'thread-existing',
        workflowLabel: 'approve_plan',
        workspaceName: 'harness-kanban-issue-101',
      }),
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'The technical plan for this issue has been approved and you must now implement it.',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'delete technical_plan.md from the branch if it is still present',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'reorganize the pull request title and body so they clearly describe the final implementation instead of the planning phase',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'If none is provided, use Conventional Commits.',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'If the user or repository provides a pull request template, follow that template.',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      '{"action":"submit_for_review","comment":"optional-issue-comment","branch_name":"your-branch-name","pr_title":"your-pr-title","pr_body":"your-pr-body"}',
    )
    expect(githubService.ensureReadyForReviewPullRequest).toHaveBeenCalledWith({
      issueId: 101,
      workspaceId: 'workspace-1',
      branchName: 'code-bot/issue-101',
      pullRequestTitle: 'feat(worker): implement planning workflow',
      pullRequestBody: '## Summary\n- implement the approved workflow\n\n## Testing\n- pnpm test',
    })
    expect(commentService.createComment).toHaveBeenCalledWith(
      101,
      'https://github.com/harness-kanban/payments-api/pull/22\n\nPlease review the implementation changes.',
      SystemBotId.CODE_BOT,
    )
  })

  it('moves the issue to needs_help when implementation requests human help', async () => {
    codexRunnerService.runCodexWithSchema.mockResolvedValue({
      threadId: 'thread-existing',
      finalMessage:
        '{"action":"request_help","comment":"The repository requires credentials that are not available in the workspace."}',
    })

    await service.startImplementation({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(githubService.ensureReadyForReviewPullRequest).not.toHaveBeenCalled()
    expect(issueService.updateIssue).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        userId: SystemBotId.CODE_BOT,
      },
      {
        issueId: 101,
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'needs_help' },
          },
          {
            propertyId: SystemPropertyId.ASSIGNEE,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'user-1' },
          },
        ],
      },
    )
    expect(commentService.createComment).toHaveBeenCalledWith(
      101,
      'The repository requires credentials that are not available in the workspace.',
      SystemBotId.CODE_BOT,
    )
  })

  it('repairs an invalid implementation response by resuming the same Codex thread', async () => {
    codexRunnerService.runCodexWithSchema
      .mockResolvedValueOnce({
        threadId: 'thread-existing',
        finalMessage: 'not valid json',
      })
      .mockResolvedValueOnce({
        threadId: 'thread-existing',
        finalMessage:
          '{"action":"submit_for_review","comment":"","branch_name":"code-bot/issue-101","pr_title":"feat(worker): implement planning workflow","pr_body":"Implementation PR body"}',
      })

    await service.startImplementation({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(codexRunnerService.runCodexWithSchema).toHaveBeenCalledTimes(2)
    expect(codexRunnerService.runCodexWithSchema.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        issueId: 101,
        repoRoot: '/workspaces/harness-kanban-issue-101',
        resumeThreadId: 'thread-existing',
        workflowLabel: 'approve_plan repair',
        workspaceName: 'harness-kanban-issue-101',
      }),
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[1]?.[0].prompt).toContain('Reply again with JSON only')
    expect(codexRunnerService.runCodexWithSchema.mock.calls[1]?.[0].prompt).toContain(
      '{"action":"request_help","comment":"..."}',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[1]?.[0].prompt).toContain(
      '{"action":"submit_for_review","comment":"optional-issue-comment","branch_name":"...","pr_title":"...","pr_body":"..."}',
    )
  })

  it('applies requested code changes using the implementation PR context', async () => {
    codexRunnerService.runCodexWithSchema.mockResolvedValue({
      threadId: 'thread-existing',
      finalMessage:
        '{"action":"submit_for_review","comment":"","branch_name":"code-bot/issue-101","pr_title":"fix(worker): address review feedback","pr_body":"Updated implementation details."}',
    })

    await service.applyRequestedCodeChanges({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(githubService.getImplementationPullRequestContext).toHaveBeenCalledWith({
      issueId: 101,
      workspaceId: 'workspace-1',
    })
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'Revise the implementation after code review feedback.',
    )
    expect(codexRunnerService.runCodexWithSchema.mock.calls[0]?.[0].prompt).toContain('Please rename this helper.')
  })
})
