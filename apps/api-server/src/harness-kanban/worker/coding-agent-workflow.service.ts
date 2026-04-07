import { z } from 'zod'

import { PrismaService } from '@/database/prisma.service'
import { CodingAgentSnapshotService } from '@/harness-kanban/coding-agent/coding-agent-snapshot.service'
import { CommentService } from '@/issue/comment.service'
import { IssueService } from '@/issue/issue.service'
import { SystemBotId } from '@/user/constants/user.constants'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CodingAgentDetail } from '@repo/shared'
import { Comment } from '@repo/shared/issue/types'
import { CommonPropertyOperationType, SystemPropertyId } from '@repo/shared/property/constants'
import { Issue } from '@repo/shared/property/types'
import { HarnessWorkerDevpodService } from './devpod.service'
import {
  HarnessWorkerGithubService,
  ImplementationPullRequestContext,
  ImplementationPullRequestReadiness,
  PlanPullRequestContext,
} from './github.service'
import { HarnessWorkerCodingAgentProviderRegistry } from './providers/coding-agent-provider.registry'
import {
  HARNESS_WORKER_IN_REVIEW_ISSUE_STATUS,
  HARNESS_WORKER_NEEDS_CLARIFICATION_ISSUE_STATUS,
  HARNESS_WORKER_NEEDS_HELP_ISSUE_STATUS,
  HARNESS_WORKER_PLAN_IN_REVIEW_ISSUE_STATUS,
} from './worker.constants'

const DEFAULT_CODING_AGENT_OUTPUT_REPAIR_ATTEMPTS = 2
const DEFAULT_IMPLEMENTATION_REVIEW_REPAIR_ATTEMPTS = 3
const DEFAULT_CODING_AGENT_TIMEOUT_MS = 30 * 60 * 1000

const askQuestionsResultSchema = z.object({
  action: z.literal('ask_questions'),
  comment: z.string().trim().min(1),
})

const submitPlanResultSchema = z.object({
  action: z.literal('submit_plan'),
  comment: z.string(),
  branch_name: z.string().trim().min(1),
  pr_title: z.string().trim().min(1),
  pr_body: z.string().trim().min(1),
})

const planningEnvelopeSchema = z.object({
  action: z.enum(['ask_questions', 'submit_plan']),
  comment: z.string(),
  branch_name: z.string(),
  pr_title: z.string(),
  pr_body: z.string(),
})

const planningResultSchema = z.union([askQuestionsResultSchema, submitPlanResultSchema])

const planningOutputJsonSchema = {
  type: 'object',
  description:
    "For planning runs, you must author the draft pull request title and body yourself and return them in this JSON response. Write the pull request title and body in the same language the user used in the issue details and comments. When referring to the issue in pull request content, avoid '#<issueId>' and use a natural-language reference such as 'issue 123' instead so it is not confused with GitHub issue references.",
  properties: {
    action: {
      type: 'string',
      enum: ['ask_questions', 'submit_plan'],
      description:
        "Use 'ask_questions' only when clarification is required. Use 'submit_plan' only after the plan branch is committed and pushed, and after you have authored the pull request title and body in the user's language.",
    },
    comment: {
      type: 'string',
      description:
        "For 'ask_questions', write the clarification question in the user's language when appropriate. For 'submit_plan', this is an optional issue comment that the system will place below the pull request URL, also in the user's language.",
    },
    branch_name: {
      type: 'string',
      description:
        "For 'submit_plan', return the technical plan branch name. For 'ask_questions', return an empty string.",
    },
    pr_title: {
      type: 'string',
      description:
        "For 'submit_plan', return the draft pull request title in the user's language. For 'ask_questions', return an empty string.",
    },
    pr_body: {
      type: 'string',
      description:
        "For 'submit_plan', return the draft pull request body in the user's language. Follow any user or repository pull request template when present. For 'ask_questions', return an empty string.",
    },
  },
  required: ['action', 'comment', 'branch_name', 'pr_title', 'pr_body'],
  additionalProperties: false,
} as const

const requestHelpResultSchema = z.object({
  action: z.literal('request_help'),
  comment: z.string().trim().min(1),
})

const submitForReviewResultSchema = z.object({
  action: z.literal('submit_for_review'),
  comment: z.string(),
  branch_name: z.string().trim().min(1),
  pr_title: z.string().trim().min(1),
  pr_body: z.string().trim().min(1),
})

const implementationEnvelopeSchema = z.object({
  action: z.enum(['request_help', 'submit_for_review']),
  comment: z.string(),
  branch_name: z.string(),
  pr_title: z.string(),
  pr_body: z.string(),
})

const implementationResultSchema = z.union([requestHelpResultSchema, submitForReviewResultSchema])

const implementationOutputJsonSchema = {
  type: 'object',
  description:
    'For implementation runs, write any issue comment, pull request title, and pull request body in the same language the user used in the issue details and comments. If the user or repository provides a pull request template, follow it in the pull request body.',
  properties: {
    action: {
      type: 'string',
      enum: ['request_help', 'submit_for_review'],
      description:
        "Use 'request_help' only when truly blocked. Use 'submit_for_review' only after the branch is pushed and the pull request title and body are authored in the user's language.",
    },
    comment: {
      type: 'string',
      description:
        "For 'request_help', explain the blocker in the user's language when appropriate. For 'submit_for_review', this is an optional issue comment that the system will place below the pull request URL, also in the user's language.",
    },
    branch_name: {
      type: 'string',
      description:
        "For 'submit_for_review', return the implementation branch name. For 'request_help', return an empty string.",
    },
    pr_title: {
      type: 'string',
      description:
        "For 'submit_for_review', return the implementation pull request title in the user's language. For 'request_help', return an empty string.",
    },
    pr_body: {
      type: 'string',
      description:
        "For 'submit_for_review', return the implementation pull request body in the user's language. Follow any user or repository pull request template when present. For 'request_help', return an empty string.",
    },
  },
  required: ['action', 'comment', 'branch_name', 'pr_title', 'pr_body'],
  additionalProperties: false,
} as const

type HarnessWorkerCodingAgentWorkflowInput = {
  issueId: number
  workspaceId: string
  workspaceName: string
}

type IssueDetail = {
  comments: Array<Record<string, unknown>>
  createdBy: string
  description: string | null
  issueId: number
  priority: string | null
  projectId: string | null
  status: string | null
  title: string
  workspaceId: string
}

type PlanningResult = z.infer<typeof planningResultSchema>
type ImplementationResult = z.infer<typeof implementationResultSchema>

type ParsedPlanningResult =
  | {
      data: PlanningResult
      error: null
    }
  | {
      data: null
      error: string
    }

type ParsedImplementationResult =
  | {
      data: ImplementationResult
      error: null
    }
  | {
      data: null
      error: string
    }

type HarnessWorkerImplementationMode =
  | 'approve_plan'
  | 'resume_implementation'
  | 'requested_code_changes'
  | 'repair_review_readiness'

type RunImplementationInput = {
  implementationPullRequestContext?: ImplementationPullRequestContext | null
  issueId: number
  mode: HarnessWorkerImplementationMode
  planPullRequestContext?: PlanPullRequestContext | null
  readinessFailure?: ImplementationPullRequestReadiness | null
  workspaceName: string
}

type StructuredCodingAgentRunInput = {
  issueId: number
  outputJsonSchema: unknown
  prompt: string
  repoRoot: string
  resumeSessionId?: string
  workspaceName: string
  workflowLabel: string
}

@Injectable()
export class HarnessWorkerCodingAgentWorkflowService {
  private readonly logger = new Logger(HarnessWorkerCodingAgentWorkflowService.name)
  private readonly outputRepairAttempts: number
  private readonly implementationReviewRepairAttempts: number
  private readonly codingAgentTimeoutMs: number

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly codingAgentSnapshotService: CodingAgentSnapshotService,
    private readonly issueService: IssueService,
    private readonly commentService: CommentService,
    private readonly githubService: HarnessWorkerGithubService,
    private readonly codingAgentProviderRegistry: HarnessWorkerCodingAgentProviderRegistry,
    private readonly devpodService: HarnessWorkerDevpodService,
  ) {
    this.outputRepairAttempts = this.getPositiveInteger(
      'HARNESS_WORKER_CODING_AGENT_OUTPUT_REPAIR_ATTEMPTS',
      this.getPositiveInteger(
        'HARNESS_WORKER_CODEX_OUTPUT_REPAIR_ATTEMPTS',
        DEFAULT_CODING_AGENT_OUTPUT_REPAIR_ATTEMPTS,
      ),
    )
    this.implementationReviewRepairAttempts = this.getPositiveInteger(
      'HARNESS_WORKER_IMPLEMENTATION_REVIEW_REPAIR_ATTEMPTS',
      DEFAULT_IMPLEMENTATION_REVIEW_REPAIR_ATTEMPTS,
    )
    this.codingAgentTimeoutMs = this.getPositiveInteger(
      'HARNESS_WORKER_CODING_AGENT_TIMEOUT_MS',
      this.getPositiveInteger('HARNESS_WORKER_CODEX_TIMEOUT_MS', DEFAULT_CODING_AGENT_TIMEOUT_MS),
    )
  }

  async startPlanning(input: HarnessWorkerCodingAgentWorkflowInput): Promise<void> {
    try {
      // Start a fresh planning run from the latest issue state.
      const [issueDetail, repoRoot] = await Promise.all([
        this.loadIssueDetail(input.issueId),
        this.resolveWorkspaceRoot(input.issueId),
      ])
      const prompt = this.buildPlanningPrompt(issueDetail)
      const planningResult = await this.runPlanningAgent(
        input.issueId,
        input.workspaceName,
        repoRoot,
        prompt,
        'planning',
      )

      this.logger.log(
        `Completed startPlanning workflow for issue ${input.issueId} with action ${planningResult.action}`,
      )
      await this.handlePlanningResult(input.issueId, input.workspaceId, planningResult)
    } catch (error) {
      await this.handlePlanningFailure(input.issueId, input.workspaceId, error, {
        instruction: 'Please resolve the blocker and trigger the next planning step when work should continue.',
        workflowLabel: 'startPlanning',
      })
    }
  }

  async resumePlanning(input: HarnessWorkerCodingAgentWorkflowInput): Promise<void> {
    try {
      // Resume the existing planning thread after the user added clarification.
      const [sessionId, issueDetail, repoRoot] = await Promise.all([
        this.loadCodingAgentSessionId(input.issueId),
        this.loadIssueDetail(input.issueId),
        this.resolveWorkspaceRoot(input.issueId),
      ])
      const prompt = this.buildResumePlanningPrompt(issueDetail, null)
      const planningResult = await this.runPlanningAgent(
        input.issueId,
        input.workspaceName,
        repoRoot,
        prompt,
        'resume planning',
        {
          resumeSessionId: sessionId,
        },
      )

      this.logger.log(
        `Completed resumePlanning workflow for issue ${input.issueId} with action ${planningResult.action}`,
      )
      await this.handlePlanningResult(input.issueId, input.workspaceId, planningResult)
    } catch (error) {
      await this.handlePlanningFailure(input.issueId, input.workspaceId, error, {
        instruction: 'Please resolve the blocker and move the issue back to Planning if planning should continue.',
        workflowLabel: 'resumePlanning',
      })
    }
  }

  async requestPlanChanges(input: HarnessWorkerCodingAgentWorkflowInput): Promise<void> {
    try {
      // Resume the planning thread with the current plan PR and review feedback.
      const [sessionId, issueDetail, repoRoot, pullRequestContext] = await Promise.all([
        this.loadCodingAgentSessionId(input.issueId),
        this.loadIssueDetail(input.issueId),
        this.resolveWorkspaceRoot(input.issueId),
        this.githubService.getPlanPullRequestContext({
          issueId: input.issueId,
          workspaceId: input.workspaceId,
        }),
      ])
      const prompt = this.buildResumePlanningPrompt(issueDetail, pullRequestContext)
      const planningResult = await this.runPlanningAgent(
        input.issueId,
        input.workspaceName,
        repoRoot,
        prompt,
        'resume planning',
        {
          resumeSessionId: sessionId,
        },
      )

      this.logger.log(
        `Completed requestPlanChanges workflow for issue ${input.issueId} with action ${planningResult.action}`,
      )
      await this.handlePlanningResult(input.issueId, input.workspaceId, planningResult)
    } catch (error) {
      await this.handlePlanningFailure(input.issueId, input.workspaceId, error, {
        instruction: 'Please resolve the blocker and move the issue back to Planning if planning should continue.',
        workflowLabel: 'requestPlanChanges',
      })
    }
  }

  async startImplementation(input: HarnessWorkerCodingAgentWorkflowInput): Promise<void> {
    try {
      const planPullRequestContext = await this.githubService.getPlanPullRequestContext({
        issueId: input.issueId,
        workspaceId: input.workspaceId,
      })
      const implementationResult = await this.runImplementationForIssue({
        issueId: input.issueId,
        mode: 'approve_plan',
        planPullRequestContext,
        workspaceName: input.workspaceName,
      })

      this.logger.log(
        `Completed startImplementation workflow for issue ${input.issueId} with action ${implementationResult.action}`,
      )
      await this.handleImplementationResult(input, implementationResult)
    } catch (error) {
      await this.handleImplementationFailure(input.issueId, input.workspaceId, error)
    }
  }

  async resumeImplementation(input: HarnessWorkerCodingAgentWorkflowInput): Promise<void> {
    try {
      const implementationPullRequestContext = await this.githubService.findImplementationPullRequestContext({
        issueId: input.issueId,
        workspaceId: input.workspaceId,
      })
      const implementationResult = await this.runImplementationForIssue({
        implementationPullRequestContext,
        issueId: input.issueId,
        mode: 'resume_implementation',
        workspaceName: input.workspaceName,
      })

      this.logger.log(
        `Completed resumeImplementation workflow for issue ${input.issueId} with action ${implementationResult.action}`,
      )
      await this.handleImplementationResult(input, implementationResult)
    } catch (error) {
      await this.handleImplementationFailure(input.issueId, input.workspaceId, error)
    }
  }

  async applyRequestedCodeChanges(input: HarnessWorkerCodingAgentWorkflowInput): Promise<void> {
    try {
      const implementationPullRequestContext = await this.githubService.getImplementationPullRequestContext({
        issueId: input.issueId,
        workspaceId: input.workspaceId,
      })
      const implementationResult = await this.runImplementationForIssue({
        implementationPullRequestContext,
        issueId: input.issueId,
        mode: 'requested_code_changes',
        workspaceName: input.workspaceName,
      })

      this.logger.log(
        `Completed applyRequestedCodeChanges workflow for issue ${input.issueId} with action ${implementationResult.action}`,
      )
      await this.handleImplementationResult(input, implementationResult)
    } catch (error) {
      await this.handleImplementationFailure(input.issueId, input.workspaceId, error)
    }
  }

  private async runPlanningAgent(
    issueId: number,
    workspaceName: string,
    repoRoot: string,
    prompt: string,
    workflowLabel: string,
    options?: {
      resumeSessionId?: string
    },
  ): Promise<PlanningResult> {
    this.logger.log(`Starting coding agent ${workflowLabel} run for issue ${issueId} in workspace ${workspaceName}`)
    const initialResult = await this.runCodingAgentWithSchema({
      issueId,
      outputJsonSchema: planningOutputJsonSchema,
      prompt,
      repoRoot,
      resumeSessionId: options?.resumeSessionId,
      workspaceName,
      workflowLabel,
    })
    let latestSessionId = initialResult.sessionId
    let latestRawOutput = initialResult.finalMessage
    let parsedResult = this.parsePlanningResult(latestRawOutput)

    if (parsedResult.data) {
      this.logger.log(
        `Coding agent ${workflowLabel} run for issue ${issueId} completed with action ${parsedResult.data.action}`,
      )
      return parsedResult.data
    }

    this.logger.warn(
      `Coding agent returned invalid ${workflowLabel} output for issue ${issueId}; attempting repair via resume`,
    )

    for (let attempt = 1; attempt <= this.outputRepairAttempts; attempt += 1) {
      const repairResult = await this.runCodingAgentWithSchema({
        issueId,
        outputJsonSchema: planningOutputJsonSchema,
        prompt: this.buildPlanningRepairPrompt(parsedResult.error, latestRawOutput),
        repoRoot,
        resumeSessionId: latestSessionId,
        workspaceName,
        workflowLabel: `${workflowLabel} repair`,
      })
      latestSessionId = repairResult.sessionId
      latestRawOutput = repairResult.finalMessage
      parsedResult = this.parsePlanningResult(latestRawOutput)

      if (parsedResult.data) {
        this.logger.log(
          `Coding agent ${workflowLabel} repair for issue ${issueId} completed with action ${parsedResult.data.action}`,
        )
        return parsedResult.data
      }
    }

    throw new Error(`Coding agent ${workflowLabel} output is invalid: ${parsedResult.error}`)
  }

  private async runImplementationForIssue(input: RunImplementationInput): Promise<ImplementationResult> {
    const [sessionId, issueDetail, repoRoot] = await Promise.all([
      this.loadCodingAgentSessionId(input.issueId),
      this.loadIssueDetail(input.issueId),
      this.resolveWorkspaceRoot(input.issueId),
    ])
    const prompt = this.buildImplementationPrompt(issueDetail, input)

    return this.runImplementationAgent(input.issueId, input.workspaceName, repoRoot, prompt, input.mode, {
      resumeSessionId: sessionId,
    })
  }

  private async runImplementationAgent(
    issueId: number,
    workspaceName: string,
    repoRoot: string,
    prompt: string,
    workflowLabel: string,
    options?: {
      resumeSessionId?: string
    },
  ): Promise<ImplementationResult> {
    this.logger.log(`Starting coding agent ${workflowLabel} run for issue ${issueId} in workspace ${workspaceName}`)
    const initialResult = await this.runCodingAgentWithSchema({
      issueId,
      outputJsonSchema: implementationOutputJsonSchema,
      prompt,
      repoRoot,
      resumeSessionId: options?.resumeSessionId,
      workspaceName,
      workflowLabel,
    })
    let latestSessionId = initialResult.sessionId
    let latestRawOutput = initialResult.finalMessage
    let parsedResult = this.parseImplementationResult(latestRawOutput)

    if (parsedResult.data) {
      this.logger.log(
        `Coding agent ${workflowLabel} run for issue ${issueId} completed with action ${parsedResult.data.action}`,
      )
      return parsedResult.data
    }

    this.logger.warn(
      `Coding agent returned invalid ${workflowLabel} output for issue ${issueId}; attempting repair via resume`,
    )

    for (let attempt = 1; attempt <= this.outputRepairAttempts; attempt += 1) {
      const repairResult = await this.runCodingAgentWithSchema({
        issueId,
        outputJsonSchema: implementationOutputJsonSchema,
        prompt: this.buildImplementationRepairPrompt(parsedResult.error, latestRawOutput),
        repoRoot,
        resumeSessionId: latestSessionId,
        workspaceName,
        workflowLabel: `${workflowLabel} repair`,
      })
      latestSessionId = repairResult.sessionId
      latestRawOutput = repairResult.finalMessage
      parsedResult = this.parseImplementationResult(latestRawOutput)

      if (parsedResult.data) {
        this.logger.log(
          `Coding agent ${workflowLabel} repair for issue ${issueId} completed with action ${parsedResult.data.action}`,
        )
        return parsedResult.data
      }
    }

    throw new Error(`Coding agent ${workflowLabel} output is invalid: ${parsedResult.error}`)
  }

  private async loadIssueDetail(issueId: number): Promise<IssueDetail> {
    const [issueRecord, issue, comments] = await Promise.all([
      this.prisma.client.issue.findUnique({
        where: { id: issueId },
        select: {
          created_by: true,
          workspace_id: true,
        },
      }),
      this.issueService.getIssueById(issueId),
      this.commentService.queryComments(issueId),
    ])

    if (!issueRecord?.workspace_id) {
      throw new Error(`Issue ${issueId} is missing a workspace binding`)
    }

    return {
      issueId,
      workspaceId: issueRecord.workspace_id,
      createdBy: issueRecord.created_by,
      title: this.getPropertyValue(issue, SystemPropertyId.TITLE) ?? `Issue #${issueId}`,
      description: this.getPropertyValue(issue, SystemPropertyId.DESCRIPTION),
      status: this.getPropertyValue(issue, SystemPropertyId.STATUS),
      priority: this.getPropertyValue(issue, SystemPropertyId.PRIORITY),
      projectId: this.getPropertyValue(issue, SystemPropertyId.PROJECT),
      comments: this.serializeComments(comments),
    }
  }

  private async loadCodingAgentSessionId(issueId: number): Promise<string> {
    const executionState = await this.codingAgentSnapshotService.getIssueCodingAgentExecutionState(issueId)
    const sessionId = executionState?.sessionId?.trim()

    if (!sessionId) {
      throw new Error(`Coding agent session id is not available for issue ${issueId}`)
    }

    return sessionId
  }

  private async runCodingAgentWithSchema(
    input: StructuredCodingAgentRunInput,
  ): Promise<{ finalMessage: string; sessionId: string }> {
    const codingAgent = await this.loadIssueCodingAgentSnapshot(input.issueId)
    const provider = this.codingAgentProviderRegistry.getProvider(codingAgent.type)
    const remoteUser = await this.devpodService.resolveWorkspaceRemoteUser(input.workspaceName)
    const result = await provider.runWithSchema({
      outputJsonSchema: input.outputJsonSchema,
      prompt: input.prompt,
      remoteUser,
      repoRoot: input.repoRoot,
      resumeSessionId: input.resumeSessionId,
      settings: codingAgent.settings,
      timeoutMs: this.codingAgentTimeoutMs,
      workflowLabel: input.workflowLabel,
      workspaceName: input.workspaceName,
      quoteShellArg: value => this.quoteShellArg(value),
      runWorkspaceCommand: (command, options) =>
        this.devpodService.runWorkspaceCommand(input.workspaceName, command, options),
    })

    await this.codingAgentSnapshotService.updateIssueCodingAgentExecutionState(input.issueId, {
      sessionId: result.sessionId,
    })

    return {
      finalMessage: result.finalMessage,
      sessionId: result.sessionId,
    }
  }

  private async loadIssueCodingAgentSnapshot(issueId: number): Promise<CodingAgentDetail> {
    const codingAgent = await this.codingAgentSnapshotService.getIssueCodingAgentSnapshot(issueId)
    if (!codingAgent) {
      throw new Error('No coding agent snapshot is available for this issue.')
    }

    return codingAgent
  }

  private async resolveWorkspaceRoot(issueId: number): Promise<string> {
    const worker = await this.prisma.client.harness_worker.findFirst({
      where: {
        issue_id: issueId,
      },
      select: {
        devpod_metadata: true,
      },
    })

    const metadata = this.asRecord(worker?.devpod_metadata)
    const result = this.asRecord(metadata?.result)
    const substitution = this.asRecord(result?.substitution)
    const containerWorkspaceFolder = substitution?.containerWorkspaceFolder

    if (typeof containerWorkspaceFolder !== 'string' || containerWorkspaceFolder.trim().length === 0) {
      throw new Error(`DevPod workspace root is not available for issue ${issueId}`)
    }

    return containerWorkspaceFolder.trim()
  }

  private buildPlanningPrompt(issueDetail: IssueDetail): string {
    const issueJson = this.serializeIssueDetail(issueDetail)

    return [
      'System message:',
      'You are a senior engineer working inside a dev container. Your job is to finish the planning task for the assigned issue.',
      'You normally do not get to chat directly with the user. Do not stop until you reach one of the required outcomes.',
      'The system communicates with the user through issue comments on your behalf.',
      '',
      'Issue details (JSON):',
      issueJson,
      '',
      'Task instructions:',
      '1. Inspect the codebase and the issue details, including comments. Follow repository guidance files such as AGENTS.md or CLAUDE.md.',
      '2. Determine whether the request is clear enough to produce a technical plan. Check for ambiguous requirements, missing acceptance criteria, and external dependencies such as OpenAI, AWS, third-party APIs, infrastructure, credentials, or data access.',
      '3. If clarification is required, do not create or modify files, branches, commits, pushes, or pull requests. Return exactly {"action":"ask_questions","comment":"..."} with the concise question(s) the system should post as an issue comment.',
      '4. If the request is clear enough, continue with planning only. Do not implement the feature itself in this phase.',
      '5. Create a new branch that is appropriate for the issue. If the repository defines a branch naming convention in AGENTS.md, CLAUDE.md, or other repository guidance, follow that convention. Otherwise, name the branch using the format <type>/<short-description>. Even during the planning phase, name the branch for the actual change being planned or implemented, not as a generic plan branch.',
      '6. In the repository root, create technical_plan.md and write the technical plan.',
      '7. The technical plan must specify changes at the granularity of classes, functions, components, database, APIs, test cases, integration points, and operational considerations when relevant.',
      '8. Use this structure for technical_plan.md:',
      '# Technical Plan',
      '',
      '## Status',
      '**Phase:** Planning',
      '',
      '## Requirements Summary',
      '[Brief summary of what needs to be implemented]',
      '',
      '## Technical Design',
      '[Detailed design at the appropriate level of granularity for this task]',
      '',
      '## Implementation Steps',
      '1. [ ] Step 1 description',
      '2. [ ] Step 2 description',
      '3. [ ] Step 3 description',
      '',
      '## Review Checklist',
      "Before marking complete, verify all items from the project's Review Rules in AGENTS.md or equivalent guidance.",
      '',
      '## Notes',
      '[Additional notes or considerations]',
      '',
      '9. Commit technical_plan.md on the new branch and push the branch to the remote repository. If the user or repository specifies a commit message convention, follow it. Otherwise, use Conventional Commits.',
      "10. Create a draft pull request if the environment supports it. You must author the pull request title and body yourself and use the same language the user used in the issue details and comments for both fields. If the user or repository provides a pull request template, follow that template. When referring to the issue in pull request content, avoid '#<issueId>' because it can be confused with GitHub issue references; use a natural-language reference such as 'issue 123' instead. The automation system will also verify or create the draft pull request based on the branch, title, and body you return.",
      '11. For submit_plan, you may also provide an additional issue comment in the same language as the user. The system will place the pull request URL on the first line and then append your comment below it.',
      '12. If you do not need clarification, finish by returning exactly {"action":"submit_plan","comment":"optional-issue-comment","branch_name":"your-branch-name","pr_title":"your-pr-title","pr_body":"your-pr-body"} and nothing else.',
      '13. Do not ask clarifying questions if the request is already clear or straightforward enough to plan.',
      '14. Do not wrap the final JSON in markdown fences and do not include extra prose.',
    ].join('\n')
  }

  private buildResumePlanningPrompt(
    issueDetail: IssueDetail,
    pullRequestContext: PlanPullRequestContext | null,
  ): string {
    const issueJson = this.serializeIssueDetail(issueDetail)
    const pullRequestJson = pullRequestContext ? JSON.stringify(pullRequestContext, null, 2) : null
    const existingBranch = pullRequestContext?.pullRequest.headBranch ?? null

    return [
      'System message:',
      pullRequestContext
        ? 'You are a senior engineer working inside a dev container. Your job is to revise an existing technical plan after review feedback.'
        : 'You are a senior engineer working inside a dev container. Your job is to continue technical planning after receiving new clarification from the user.',
      'You normally do not get to chat directly with the user. Do not stop until you reach one of the required outcomes.',
      'The system communicates with the user through issue comments on your behalf.',
      '',
      'Latest issue details (JSON):',
      issueJson,
      '',
      ...(pullRequestJson ? ['Current technical plan pull request context (JSON):', pullRequestJson, ''] : []),
      'Task instructions:',
      '1. This run resumes the existing coding agent conversation for the issue. Use the prior planning context unless it conflicts with the latest issue details or review feedback.',
      pullRequestContext
        ? '2. Inspect the codebase, the latest issue details, and the GitHub pull request feedback. Follow repository guidance files such as AGENTS.md or CLAUDE.md.'
        : '2. Inspect the codebase, the latest issue details, and the issue comments. Follow repository guidance files such as AGENTS.md or CLAUDE.md.',
      '3. This is still planning work. Do not implement the feature itself in this phase.',
      pullRequestContext
        ? '4. Review the existing technical plan, update technical_plan.md to address the latest feedback, and make sure the plan remains consistent with the current issue details.'
        : '4. Continue the existing technical plan, update technical_plan.md to incorporate the latest clarification, and make sure the plan remains consistent with the current issue details.',
      existingBranch
        ? `5. Continue working on the existing planning branch ${existingBranch}. Reuse it unless the branch is unavailable.`
        : '5. Continue from the existing planning context when possible.',
      '6. If clarification is required, do not create or modify files, branches, commits, pushes, or pull requests. Return exactly {"action":"ask_questions","comment":"..."} with the concise question(s) the system should post as an issue comment.',
      '7. The technical plan must specify changes at the granularity of classes, functions, components, database, APIs, test cases, integration points, and operational considerations when relevant.',
      '8. Keep the structure of technical_plan.md aligned with the repository planning template and refresh any section that changed because of the review.',
      '9. Commit the updated technical_plan.md on the planning branch and push the branch to the remote repository. If the user or repository specifies a commit message convention, follow it. Otherwise, use Conventional Commits.',
      "10. Keep or create a draft pull request if the environment supports it. You must author the pull request title and body yourself and use the same language the user used in the issue details and comments for both fields. If the user or repository provides a pull request template, follow that template. When referring to the issue in pull request content, avoid '#<issueId>' because it can be confused with GitHub issue references; use a natural-language reference such as 'issue 123' instead. The automation system will also verify or create the draft pull request based on the branch, title, and body you return.",
      '11. For submit_plan, you may also provide an additional issue comment in the same language as the user. The system will place the pull request URL on the first line and then append your comment below it.',
      '12. If you do not need clarification, finish by returning exactly {"action":"submit_plan","comment":"optional-issue-comment","branch_name":"your-branch-name","pr_title":"your-pr-title","pr_body":"your-pr-body"} and nothing else.',
      '13. Do not wrap the final JSON in markdown fences and do not include extra prose.',
    ].join('\n')
  }

  private buildImplementationPrompt(issueDetail: IssueDetail, input: RunImplementationInput): string {
    const issueJson = this.serializeIssueDetail(issueDetail)
    const planPullRequestJson = input.planPullRequestContext
      ? JSON.stringify(input.planPullRequestContext, null, 2)
      : null
    const implementationPullRequestJson = input.implementationPullRequestContext
      ? JSON.stringify(input.implementationPullRequestContext, null, 2)
      : null
    const readinessFailureJson = input.readinessFailure ? JSON.stringify(input.readinessFailure, null, 2) : null
    const existingBranch =
      input.implementationPullRequestContext?.pullRequest.headBranch ??
      input.planPullRequestContext?.pullRequest.headBranch
    const taskInstructions = [
      '1. This run resumes the existing coding agent conversation for the issue. Use the prior implementation context unless it conflicts with the latest issue details.',
      this.getSecondInstructionForMode(input.mode),
      existingBranch
        ? `3. Continue working on the current implementation branch ${existingBranch}. Reuse it unless the branch is unavailable.`
        : '3. Continue from the current implementation context when possible.',
      '4. Before making code changes, initialize the workspace environment. Check the repository for setup guidance, scripts, compose files, devcontainer files, env examples, and test commands. If no guidance exists, figure out the minimum working setup yourself.',
      // TODO remind the agent that it is running in a DevContainer environment, check the devcontaienr configs
      '5. For required services such as databases, caches, object storage, or brokers, first determine whether the project environment already provides them. If services are already provided, verify from inside the current workspace container that they are reachable over the container network.',
      '6. Avoid Docker-in-Docker whenever possible. Do not assume you can control host Docker from inside the workspace. Only use Docker-based workflows if there is no safer alternative for the current container environment.',
      '7. If the project does not already provide the required services, install and run the minimum compatible local services that fit the current container environment so you can continue implementation and validation.',
      '8. Keep technical_plan.md updated as work progresses. Mark completed steps, record notable deviations, and leave the plan in a truthful state.',
      // TODO remove 9th, shouldn't be prompted by the system. it's the project's AGENTS.md's responsibility
      '9. Implement or repair the code, run the relevant checks, and fix issues before you finish. Prefer repository-standard commands for validation.',
      '10. Do not request help unless you are truly blocked after exhausting reasonable options. The user may be offline, so unnecessary help requests will stall delivery.',
      '11. If you are truly blocked by missing product decisions, unavailable credentials, unavailable external systems, or irrecoverable environment constraints, return exactly {"action":"request_help","comment":"..."} with a concise explanation of the blocker and what the user must provide.',
      '12. Before returning submit_for_review, delete technical_plan.md from the branch if it is still present, and reorganize the pull request title and body so they clearly describe the final implementation instead of the planning phase.',
      '13. When committing, follow any commit message convention provided by the user or repository. If none is provided, use Conventional Commits.',
      '14. When opening or updating the implementation pull request, use the same language the user used in the issue details and comments for the pull request title, pull request body, and any additional issue comment you provide. If the user or repository provides a pull request template, follow that template.',
      '15. If implementation is complete for this round, commit the changes, push the branch, open or update a non-draft pull request, and return exactly {"action":"submit_for_review","comment":"optional-issue-comment","branch_name":"your-branch-name","pr_title":"your-pr-title","pr_body":"your-pr-body"} and nothing else.',
      '16. The system will place the pull request URL on the first line of the issue comment and then append your comment below it.',
      '17. Do not wrap the final JSON in markdown fences and do not include extra prose.',
    ]

    return [
      'System message:',
      this.getSystemMessageForMode(input.mode),
      'You normally do not get to chat directly with the user. Do not stop until you reach one of the required outcomes.',
      'The system communicates with the user through issue comments on your behalf.',
      '',
      'Latest issue details (JSON):',
      issueJson,
      '',
      ...(planPullRequestJson ? ['Technical plan pull request context (JSON):', planPullRequestJson, ''] : []),
      ...(implementationPullRequestJson
        ? ['Current implementation pull request context (JSON):', implementationPullRequestJson, '']
        : []),
      ...(readinessFailureJson ? ['Latest automated PR readiness report (JSON):', readinessFailureJson, ''] : []),
      'Task instructions:',
      ...taskInstructions,
    ].join('\n')
  }

  private buildPlanningRepairPrompt(error: string, rawOutput: string): string {
    return [
      'Your previous response did not satisfy the required automation contract.',
      `Validation error: ${error}`,
      `Previous response: ${this.truncate(rawOutput.trim(), 500)}`,
      'Reply again with JSON only and no markdown fences.',
      'Valid responses are exactly one of:',
      '{"action":"ask_questions","comment":"..."}',
      '{"action":"submit_plan","comment":"optional-issue-comment","branch_name":"...","pr_title":"...","pr_body":"..."}',
    ].join('\n')
  }

  private buildImplementationRepairPrompt(error: string, rawOutput: string): string {
    return [
      'Your previous response did not satisfy the required automation contract.',
      `Validation error: ${error}`,
      `Previous response: ${this.truncate(rawOutput.trim(), 500)}`,
      'Reply again with JSON only and no markdown fences.',
      'Valid responses are exactly one of:',
      '{"action":"request_help","comment":"..."}',
      '{"action":"submit_for_review","comment":"optional-issue-comment","branch_name":"...","pr_title":"...","pr_body":"..."}',
    ].join('\n')
  }

  private parsePlanningResult(rawOutput: string): ParsedPlanningResult {
    const trimmedOutput = rawOutput.trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmedOutput)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        data: null,
        error: `Response is not valid JSON: ${message}`,
      }
    }

    const result = planningResultSchema.safeParse(parsed)
    if (result.success) {
      return {
        data: result.data,
        error: null,
      }
    }

    const envelopeResult = planningEnvelopeSchema.safeParse(parsed)
    if (!envelopeResult.success) {
      return {
        data: null,
        error: result.error.issues.map(issue => issue.message).join('; '),
      }
    }

    const normalizedResult = this.normalizePlanningEnvelope(envelopeResult.data)
    if (!normalizedResult) {
      return {
        data: null,
        error: 'Structured coding agent response did not include the required non-empty field for the selected action.',
      }
    }

    return {
      data: normalizedResult,
      error: null,
    }
  }

  private parseImplementationResult(rawOutput: string): ParsedImplementationResult {
    const trimmedOutput = rawOutput.trim()

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmedOutput)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        data: null,
        error: `Response is not valid JSON: ${message}`,
      }
    }

    const result = implementationResultSchema.safeParse(parsed)
    if (result.success) {
      return {
        data: result.data,
        error: null,
      }
    }

    const envelopeResult = implementationEnvelopeSchema.safeParse(parsed)
    if (!envelopeResult.success) {
      return {
        data: null,
        error: result.error.issues.map(issue => issue.message).join('; '),
      }
    }

    const normalizedResult = this.normalizeImplementationEnvelope(envelopeResult.data)
    if (!normalizedResult) {
      return {
        data: null,
        error: 'Structured coding agent response did not include the required non-empty field for the selected action.',
      }
    }

    return {
      data: normalizedResult,
      error: null,
    }
  }

  private normalizePlanningEnvelope(payload: z.infer<typeof planningEnvelopeSchema>): PlanningResult | null {
    const comment = payload.comment.trim()
    const branchName = payload.branch_name.trim()
    const pullRequestTitle = payload.pr_title.trim()
    const pullRequestBody = payload.pr_body.trim()

    if (payload.action === 'ask_questions') {
      return comment ? { action: 'ask_questions', comment } : null
    }

    return branchName && pullRequestTitle && pullRequestBody
      ? {
          action: 'submit_plan',
          comment,
          branch_name: branchName,
          pr_title: pullRequestTitle,
          pr_body: pullRequestBody,
        }
      : null
  }

  private normalizeImplementationEnvelope(
    payload: z.infer<typeof implementationEnvelopeSchema>,
  ): ImplementationResult | null {
    const comment = payload.comment.trim()
    const branchName = payload.branch_name.trim()
    const pullRequestTitle = payload.pr_title.trim()
    const pullRequestBody = payload.pr_body.trim()

    if (payload.action === 'request_help') {
      return comment ? { action: 'request_help', comment } : null
    }

    return branchName && pullRequestTitle && pullRequestBody
      ? {
          action: 'submit_for_review',
          comment,
          branch_name: branchName,
          pr_title: pullRequestTitle,
          pr_body: pullRequestBody,
        }
      : null
  }

  private getSystemMessageForMode(mode: HarnessWorkerImplementationMode): string {
    switch (mode) {
      case 'approve_plan':
        return 'You are a senior engineer working inside a dev container. The technical plan for this issue has been approved and you must now implement it.'
      case 'resume_implementation':
        return 'You are a senior engineer working inside a dev container. Resume implementation after the user responded to a previous blocker.'
      case 'requested_code_changes':
        return 'You are a senior engineer working inside a dev container. Revise the implementation after code review feedback.'
      case 'repair_review_readiness':
        return 'You are a senior engineer working inside a dev container. Your previous submit_for_review attempt is not yet reviewable because automated pull request readiness checks found problems that you must fix now.'
    }
  }

  private getSecondInstructionForMode(mode: HarnessWorkerImplementationMode): string {
    switch (mode) {
      case 'approve_plan':
        return '2. Follow repository guidance files such as AGENTS.md or CLAUDE.md. The plan is approved, so implement the feature now instead of revising the plan.'
      case 'resume_implementation':
        return '2. Follow repository guidance files such as AGENTS.md or CLAUDE.md. Inspect the latest issue comments to understand how the user answered the previous blocker, then continue implementation.'
      case 'requested_code_changes':
        return '2. Follow repository guidance files such as AGENTS.md or CLAUDE.md. Inspect the implementation pull request feedback and adjust the code so the review comments are addressed.'
      case 'repair_review_readiness':
        return '2. Follow repository guidance files such as AGENTS.md or CLAUDE.md. Inspect the automated pull request readiness report, fix the failing checks or mergeability problems, and do not return submit_for_review again until the pull request should be green and mergeable.'
    }
  }

  private async handlePlanningResult(
    issueId: number,
    workspaceId: string,
    planningResult: PlanningResult,
  ): Promise<void> {
    const summary = await this.loadIssueSummary(issueId)

    if (planningResult.action === 'ask_questions') {
      const transitionResult = await this.transitionIssue(
        issueId,
        workspaceId,
        HARNESS_WORKER_NEEDS_CLARIFICATION_ISSUE_STATUS,
        summary.createdBy,
      )
      if (!transitionResult.success) {
        throw new Error(
          `Failed to move issue ${issueId} to ${HARNESS_WORKER_NEEDS_CLARIFICATION_ISSUE_STATUS}: ${(transitionResult.errors ?? ['Unknown error']).join(', ')}`,
        )
      }

      await this.commentService.createComment(issueId, planningResult.comment, SystemBotId.CODE_BOT)
      return
    }

    const pullRequest = await this.githubService.ensureDraftPullRequest({
      issueId,
      workspaceId,
      branchName: planningResult.branch_name,
      pullRequestTitle: planningResult.pr_title,
      pullRequestBody: planningResult.pr_body,
    })

    const transitionResult = await this.transitionIssue(
      issueId,
      workspaceId,
      HARNESS_WORKER_PLAN_IN_REVIEW_ISSUE_STATUS,
      summary.createdBy,
    )
    if (!transitionResult.success) {
      throw new Error(
        `Failed to move issue ${issueId} to ${HARNESS_WORKER_PLAN_IN_REVIEW_ISSUE_STATUS}: ${(transitionResult.errors ?? ['Unknown error']).join(', ')}`,
      )
    }

    await this.commentService.createComment(
      issueId,
      this.buildPullRequestIssueComment(pullRequest.url, planningResult.comment),
      SystemBotId.CODE_BOT,
    )
  }

  private async handleImplementationResult(
    input: HarnessWorkerCodingAgentWorkflowInput,
    implementationResult: ImplementationResult,
  ): Promise<void> {
    const summary = await this.loadIssueSummary(input.issueId)

    if (implementationResult.action === 'request_help') {
      await this.moveImplementationBackToHuman(
        input.issueId,
        input.workspaceId,
        summary.createdBy,
        implementationResult.comment,
      )
      return
    }

    await this.finalizeImplementationReviewSubmission(input, summary, implementationResult)
  }

  private async finalizeImplementationReviewSubmission(
    input: HarnessWorkerCodingAgentWorkflowInput,
    summary: { createdBy: string },
    initialResult: Extract<ImplementationResult, { action: 'submit_for_review' }>,
  ): Promise<void> {
    let currentResult = initialResult

    for (let attempt = 0; attempt <= this.implementationReviewRepairAttempts; attempt += 1) {
      // Keep the PR in sync with the current branch and wait until GitHub can evaluate review readiness.
      const pullRequest = await this.githubService.ensureReadyForReviewPullRequest({
        issueId: input.issueId,
        workspaceId: input.workspaceId,
        branchName: currentResult.branch_name,
        pullRequestTitle: currentResult.pr_title,
        pullRequestBody: currentResult.pr_body,
      })
      const readiness = await this.githubService.waitForImplementationPullRequestReadiness({
        issueId: input.issueId,
        workspaceId: input.workspaceId,
        branchName: currentResult.branch_name,
      })

      if (readiness.state === 'ready') {
        const transitionResult = await this.transitionIssue(
          input.issueId,
          input.workspaceId,
          HARNESS_WORKER_IN_REVIEW_ISSUE_STATUS,
          summary.createdBy,
        )
        if (!transitionResult.success) {
          throw new Error(
            `Failed to move issue ${input.issueId} to ${HARNESS_WORKER_IN_REVIEW_ISSUE_STATUS}: ${(transitionResult.errors ?? ['Unknown error']).join(', ')}`,
          )
        }

        await this.commentService.createComment(
          input.issueId,
          this.buildPullRequestIssueComment(pullRequest.url, currentResult.comment),
          SystemBotId.CODE_BOT,
        )
        return
      }

      if (attempt === this.implementationReviewRepairAttempts) {
        throw new Error(
          `Pull request for issue ${input.issueId} is still not ready after ${this.implementationReviewRepairAttempts} repair attempts: ${readiness.summary}`,
        )
      }

      // Refresh PR context before asking coding agent to repair the readiness failure.
      const latestImplementationContext = await this.githubService.getImplementationPullRequestContext({
        branchName: readiness.context.pullRequest.headBranch,
        issueId: input.issueId,
        workspaceId: input.workspaceId,
      })
      const repairResult = await this.runImplementationForIssue({
        implementationPullRequestContext: latestImplementationContext,
        issueId: input.issueId,
        mode: 'repair_review_readiness',
        readinessFailure: {
          ...readiness,
          context: latestImplementationContext,
        },
        workspaceName: input.workspaceName,
      })
      if (repairResult.action === 'request_help') {
        await this.moveImplementationBackToHuman(
          input.issueId,
          input.workspaceId,
          summary.createdBy,
          repairResult.comment,
        )
        return
      }

      currentResult = repairResult
    }
  }

  private buildPullRequestIssueComment(pullRequestUrl: string, comment: string): string {
    const trimmedComment = comment.trim()
    return trimmedComment ? `${pullRequestUrl}\n\n${trimmedComment}` : pullRequestUrl
  }

  private async moveImplementationBackToHuman(
    issueId: number,
    workspaceId: string,
    assigneeId: string,
    comment: string,
  ): Promise<void> {
    const transitionResult = await this.transitionIssue(
      issueId,
      workspaceId,
      HARNESS_WORKER_NEEDS_HELP_ISSUE_STATUS,
      assigneeId,
    )
    if (!transitionResult.success) {
      throw new Error(
        `Failed to move issue ${issueId} to ${HARNESS_WORKER_NEEDS_HELP_ISSUE_STATUS}: ${(transitionResult.errors ?? ['Unknown error']).join(', ')}`,
      )
    }

    await this.commentService.createComment(issueId, comment, SystemBotId.CODE_BOT)
  }

  private async handlePlanningFailure(
    issueId: number,
    workspaceId: string,
    error: unknown,
    options: {
      instruction: string
      workflowLabel: string
    },
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    this.logger.error(`${options.workflowLabel} workflow failed for issue ${issueId}: ${message}`)

    try {
      const summary = await this.loadIssueSummary(issueId)
      const transitionResult = await this.transitionIssue(
        issueId,
        workspaceId,
        HARNESS_WORKER_NEEDS_CLARIFICATION_ISSUE_STATUS,
        summary.createdBy,
      )

      if (!transitionResult.success) {
        this.logger.error(
          `Failed to move issue ${issueId} to ${HARNESS_WORKER_NEEDS_CLARIFICATION_ISSUE_STATUS}: ${(transitionResult.errors ?? ['Unknown error']).join(', ')}`,
        )
      }

      await this.commentService.createComment(
        issueId,
        [
          'Technical planning automation could not complete for this issue.',
          '',
          `Blocker: ${this.truncate(message, 1_000)}`,
          '',
          options.instruction,
        ].join('\n'),
        SystemBotId.CODE_BOT,
      )
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      this.logger.error(`Failed to record ${options.workflowLabel} failure for issue ${issueId}: ${fallbackMessage}`)
    }
  }

  private async handleImplementationFailure(issueId: number, workspaceId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    this.logger.error(`Implementation workflow failed for issue ${issueId}: ${message}`)

    try {
      const summary = await this.loadIssueSummary(issueId)
      const transitionResult = await this.transitionIssue(
        issueId,
        workspaceId,
        HARNESS_WORKER_NEEDS_HELP_ISSUE_STATUS,
        summary.createdBy,
      )

      if (!transitionResult.success) {
        this.logger.error(
          `Failed to move issue ${issueId} to ${HARNESS_WORKER_NEEDS_HELP_ISSUE_STATUS}: ${(transitionResult.errors ?? ['Unknown error']).join(', ')}`,
        )
      }

      await this.commentService.createComment(
        issueId,
        [
          'Implementation automation could not complete for this issue.',
          '',
          `Blocker: ${this.truncate(message, 1_000)}`,
          '',
          'Please resolve the blocker and move the issue back to In progress if implementation should continue.',
        ].join('\n'),
        SystemBotId.CODE_BOT,
      )
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      this.logger.error(`Failed to record implementation failure for issue ${issueId}: ${fallbackMessage}`)
    }
  }

  private async transitionIssue(issueId: number, workspaceId: string, statusId: string, assigneeId?: string | null) {
    const operations = [
      {
        propertyId: SystemPropertyId.STATUS,
        operationType: CommonPropertyOperationType.SET,
        operationPayload: { value: statusId },
      },
    ]

    if (assigneeId) {
      operations.push({
        propertyId: SystemPropertyId.ASSIGNEE,
        operationType: CommonPropertyOperationType.SET,
        operationPayload: { value: assigneeId },
      })
    }

    return this.issueService.updateIssue(
      {
        workspaceId,
        userId: SystemBotId.CODE_BOT,
      },
      {
        issueId,
        operations,
      },
    )
  }

  private async loadIssueSummary(issueId: number): Promise<{ createdBy: string; title: string }> {
    const [issueRecord, titleRecord] = await Promise.all([
      this.prisma.client.issue.findUnique({
        where: { id: issueId },
        select: {
          created_by: true,
        },
      }),
      this.prisma.client.property_single_value.findFirst({
        where: {
          issue_id: issueId,
          property_id: SystemPropertyId.TITLE,
          deleted_at: null,
        },
        select: {
          value: true,
        },
      }),
    ])

    if (!issueRecord) {
      throw new Error(`Issue ${issueId} no longer exists`)
    }

    return {
      createdBy: issueRecord.created_by,
      title: titleRecord?.value?.trim() || `Issue #${issueId}`,
    }
  }

  private serializeIssueDetail(issueDetail: IssueDetail): string {
    return JSON.stringify(
      {
        issue: {
          id: issueDetail.issueId,
          title: issueDetail.title,
          description: issueDetail.description,
          status: issueDetail.status,
          priority: issueDetail.priority,
          projectId: issueDetail.projectId,
          createdBy: issueDetail.createdBy,
          workspaceId: issueDetail.workspaceId,
        },
        comments: issueDetail.comments,
      },
      null,
      2,
    )
  }

  private getPropertyValue(issue: Issue, propertyId: SystemPropertyId): string | null {
    const propertyValue = issue.propertyValues.find(value => value.propertyId === propertyId)?.value
    return typeof propertyValue === 'string' && propertyValue.trim().length > 0 ? propertyValue.trim() : null
  }

  private serializeComments(comments: Comment[]): Array<Record<string, unknown>> {
    return comments.map(comment => ({
      id: comment.id,
      createdBy: comment.createdBy,
      createdAt: new Date(comment.createdAt).toISOString(),
      updatedAt: new Date(comment.updatedAt).toISOString(),
      content: comment.content,
      replies: this.serializeComments(comment.subComments ?? []),
    }))
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value
    }

    return `${value.slice(0, maxLength - 3)}...`
  }

  private getPositiveInteger(key: string, fallback: number): number {
    const rawValue = this.configService.get<string | number | undefined>(key)
    const parsedValue =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string'
          ? Number.parseInt(rawValue.trim(), 10)
          : Number.NaN

    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }

    return value as Record<string, unknown>
  }

  private quoteShellArg(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`
  }
}
