import { PrismaService } from '@/database/prisma.service'
import { CodingAgentSnapshotService } from '@/harness-kanban/coding-agent/coding-agent-snapshot.service'
import { CommentService } from '@/issue/comment.service'
import { IssueService } from '@/issue/issue.service'
import { SystemBotId } from '@/user/constants/user.constants'
import { ConfigService } from '@nestjs/config'
import { CommonPropertyOperationType, SystemPropertyId } from '@repo/shared/property/constants'
import { HarnessWorkerCodingAgentWorkflowService } from '../coding-agent-workflow.service'
import { HarnessWorkerDevpodService } from '../devpod.service'
import { HarnessWorkerGithubService } from '../github.service'
import { HarnessWorkerCodingAgentProviderRegistry } from '../providers/coding-agent-provider.registry'

describe('HarnessWorkerCodingAgentWorkflowService', () => {
  let service: HarnessWorkerCodingAgentWorkflowService
  let prismaService: jest.Mocked<PrismaService>
  let configService: jest.Mocked<ConfigService>
  let codingAgentSnapshotService: jest.Mocked<CodingAgentSnapshotService>
  let issueService: jest.Mocked<IssueService>
  let commentService: jest.Mocked<CommentService>
  let githubService: jest.Mocked<HarnessWorkerGithubService>
  let providerRegistry: jest.Mocked<HarnessWorkerCodingAgentProviderRegistry>
  let devpodService: jest.Mocked<HarnessWorkerDevpodService>
  let provider: { runWithSchema: jest.Mock }

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
        harness_worker: {
          findFirst: jest.fn().mockResolvedValue({
            devpod_metadata: {
              result: {
                substitution: {
                  containerWorkspaceFolder: '/workspaces/harness-kanban-issue-101',
                },
              },
            },
          }),
        },
        project: {
          findFirst: jest.fn().mockResolvedValue({
            validation_commands: null,
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

    codingAgentSnapshotService = {
      getIssueCodingAgentSnapshot: jest.fn().mockResolvedValue({
        id: 'snapshot-1',
        name: 'Primary Claude Code',
        type: 'claude-code',
        settings: {
          apiKey: 'sk-test-123',
          baseUrl: 'https://api.example.com/',
          model: 'claude-sonnet-4-5',
        },
        isDefault: false,
        createdAt: '2026-04-04T00:00:00.000Z',
        updatedAt: '2026-04-04T00:00:00.000Z',
      }),
      getIssueCodingAgentExecutionState: jest.fn().mockResolvedValue({
        sessionId: 'session-existing',
      }),
      updateIssueCodingAgentExecutionState: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CodingAgentSnapshotService>

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
          title: 'Technical plan for issue 101: Continuation workflow',
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
        reviewComments: [],
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
            title: 'Issue 101: Continuation workflow',
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
          title: 'Issue 101: Continuation workflow',
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

    provider = {
      runWithSchema: jest.fn(),
    }

    providerRegistry = {
      getProvider: jest.fn().mockReturnValue(provider),
    } as unknown as jest.Mocked<HarnessWorkerCodingAgentProviderRegistry>

    devpodService = {
      resolveWorkspaceRemoteUser: jest.fn().mockResolvedValue('node'),
      runWorkspaceCommand: jest.fn(),
    } as unknown as jest.Mocked<HarnessWorkerDevpodService>

    service = new HarnessWorkerCodingAgentWorkflowService(
      prismaService,
      configService,
      codingAgentSnapshotService,
      issueService,
      commentService,
      githubService,
      providerRegistry,
      devpodService,
    )
  })

  it('starts planning and submits the technical plan pull request', async () => {
    provider.runWithSchema.mockResolvedValue({
      sessionId: 'session-1',
      finalMessage:
        '{"action":"submit_plan","comment":"Please review the technical plan.","branch_name":"code-bot/issue-101-plan","pr_title":"Plan issue 101: Planning workflow","pr_body":"Create the technical plan and keep the rollout small."}',
    })

    await service.startPlanning({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(providerRegistry.getProvider).toHaveBeenCalledWith('claude-code')
    expect(provider.runWithSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        repoRoot: '/workspaces/harness-kanban-issue-101',
        resumeSessionId: undefined,
        remoteUser: 'node',
        timeoutMs: 30 * 60 * 1000,
        workflowLabel: 'planning',
        workspaceName: 'harness-kanban-issue-101',
      }),
    )
    expect(provider.runWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'finish the planning task for the assigned issue',
    )
    expect(codingAgentSnapshotService.updateIssueCodingAgentExecutionState).toHaveBeenCalledWith(101, {
      sessionId: 'session-1',
    })
    expect(githubService.ensureDraftPullRequest).toHaveBeenCalledWith({
      issueId: 101,
      workspaceId: 'workspace-1',
      branchName: 'code-bot/issue-101-plan',
      pullRequestTitle: 'Plan issue 101: Planning workflow',
      pullRequestBody: 'Create the technical plan and keep the rollout small.',
    })
    expect(commentService.createComment).toHaveBeenCalledWith(
      101,
      'https://github.com/harness-kanban/payments-api/pull/17\n\nPlease review the technical plan.',
      SystemBotId.CODE_BOT,
    )
  })

  it('repairs an invalid planning response by resuming the same session', async () => {
    provider.runWithSchema
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        finalMessage: 'not valid json',
      })
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        finalMessage: '{"action":"ask_questions","comment":"Which AWS account should this planning flow target?"}',
      })

    await service.startPlanning({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(provider.runWithSchema).toHaveBeenCalledTimes(2)
    expect(provider.runWithSchema.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        repoRoot: '/workspaces/harness-kanban-issue-101',
        resumeSessionId: 'session-1',
        workflowLabel: 'planning repair',
      }),
    )
    expect(provider.runWithSchema.mock.calls[1]?.[0].prompt).toContain('Reply again with JSON only')
  })

  it('builds the requestPlanChanges prompt with pull request review context', async () => {
    provider.runWithSchema.mockResolvedValue({
      sessionId: 'session-existing',
      finalMessage:
        '{"action":"submit_plan","comment":"I updated the plan based on review feedback.","branch_name":"code-bot/issue-101-plan","pr_title":"Plan issue 101: Planning workflow","pr_body":"Update the technical plan with the latest feedback."}',
    })

    await service.requestPlanChanges({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(codingAgentSnapshotService.getIssueCodingAgentExecutionState).toHaveBeenCalledWith(101)
    expect(provider.runWithSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeSessionId: 'session-existing',
        workflowLabel: 'resume planning',
      }),
    )
    expect(provider.runWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'revise an existing technical plan after review feedback',
    )
    expect(provider.runWithSchema.mock.calls[0]?.[0].prompt).toContain('Please tighten the implementation steps.')
  })

  it('starts implementation and moves the pull request into review', async () => {
    provider.runWithSchema.mockResolvedValue({
      sessionId: 'session-existing',
      finalMessage:
        '{"action":"submit_for_review","comment":"Please review the implementation changes.","branch_name":"code-bot/issue-101","pr_title":"feat(worker): implement planning workflow","pr_body":"## Summary\\n- implement the approved workflow\\n\\n## Testing\\n- pnpm test"}',
    })

    await service.startImplementation({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    expect(provider.runWithSchema).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeSessionId: 'session-existing',
        workflowLabel: 'approve_plan',
      }),
    )
    expect(provider.runWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'The technical plan for this issue has been approved and you must now implement it.',
    )
    expect(githubService.ensureReadyForReviewPullRequest).toHaveBeenCalledWith({
      issueId: 101,
      workspaceId: 'workspace-1',
      branchName: 'code-bot/issue-101',
      pullRequestTitle: 'feat(worker): implement planning workflow',
      pullRequestBody: '## Summary\n- implement the approved workflow\n\n## Testing\n- pnpm test',
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
            operationPayload: { value: 'in_review' },
          },
          {
            propertyId: SystemPropertyId.ASSIGNEE,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'user-1' },
          },
        ],
      },
    )
  })

  it('runs all project validation commands and asks the agent to repair failed commands', async () => {
    ;(prismaService.client.project.findFirst as jest.Mock).mockResolvedValue({
      validation_commands: ['pnpm type-check', 'pnpm test', 'pnpm build'],
    })
    provider.runWithSchema
      .mockResolvedValueOnce({
        sessionId: 'session-existing',
        finalMessage:
          '{"action":"submit_for_review","comment":"Please review.","branch_name":"code-bot/issue-101","pr_title":"feat(worker): implement validation","pr_body":"Ready."}',
      })
      .mockResolvedValueOnce({
        sessionId: 'session-existing',
        finalMessage:
          '{"action":"submit_for_review","comment":"Validation fixed.","branch_name":"code-bot/issue-101","pr_title":"feat(worker): implement validation","pr_body":"Ready after validation fixes."}',
      })

    let validationCommandCalls = 0
    ;(devpodService.runWorkspaceCommand as jest.Mock).mockImplementation(
      async (_workspaceName: string, command: string) => {
        validationCommandCalls += 1
        if (validationCommandCalls <= 3 && (command.includes('pnpm type-check') || command.includes('pnpm build'))) {
          throw new Error('command failed')
        }
        return { stdout: '', stderr: '' }
      },
    )

    await service.startImplementation({
      issueId: 101,
      workspaceId: 'workspace-1',
      workspaceName: 'harness-kanban-issue-101',
    })

    const validationCommands = (devpodService.runWorkspaceCommand as jest.Mock).mock.calls.map(call => call[1])
    expect(validationCommands).toEqual([
      "cd '/workspaces/harness-kanban-issue-101' && pnpm type-check",
      "cd '/workspaces/harness-kanban-issue-101' && pnpm test",
      "cd '/workspaces/harness-kanban-issue-101' && pnpm build",
      "cd '/workspaces/harness-kanban-issue-101' && pnpm type-check",
      "cd '/workspaces/harness-kanban-issue-101' && pnpm test",
      "cd '/workspaces/harness-kanban-issue-101' && pnpm build",
    ])
    expect(provider.runWithSchema).toHaveBeenCalledTimes(2)
    expect(provider.runWithSchema.mock.calls[1]?.[0].workflowLabel).toBe('repair_validation_failure')
    expect(provider.runWithSchema.mock.calls[1]?.[0].prompt).toContain('"failedCommands": [')
    expect(provider.runWithSchema.mock.calls[1]?.[0].prompt).toContain('"pnpm type-check"')
    expect(provider.runWithSchema.mock.calls[1]?.[0].prompt).toContain('"pnpm build"')
    expect(provider.runWithSchema.mock.calls[1]?.[0].prompt).not.toContain('command failed')
  })

  it('moves the issue to needs_help when implementation requests human help', async () => {
    provider.runWithSchema.mockResolvedValue({
      sessionId: 'session-existing',
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
  })

  it('applies requested code changes using the implementation pull request context', async () => {
    provider.runWithSchema.mockResolvedValue({
      sessionId: 'session-existing',
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
    expect(provider.runWithSchema.mock.calls[0]?.[0].prompt).toContain(
      'Revise the implementation after code review feedback.',
    )
    expect(provider.runWithSchema.mock.calls[0]?.[0].prompt).toContain('Please rename this helper.')
  })
})
