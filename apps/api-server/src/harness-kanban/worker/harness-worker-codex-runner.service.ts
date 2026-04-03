import { z } from 'zod'

import { PrismaService } from '@/database/prisma.service'
import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@repo/database'
import { HarnessWorkerDevpodService } from './harness-worker-devpod.service'

const DEFAULT_CODEX_TIMEOUT_MS = 30 * 60 * 1000

const codexExecutionResultSchema = z.object({
  finalMessage: z.string(),
  threadId: z.string().trim().min(1),
})

const codexExecutionEnvelopeSchema = z.object({
  codexStderr: z.string(),
  errorMessages: z.array(z.string()),
  exitCode: z.number().int(),
  finalMessage: z.string(),
  threadId: z.string().trim().min(1).nullable(),
})

export type HarnessWorkerCodexRunResult = z.infer<typeof codexExecutionResultSchema>
type HarnessWorkerCodexExecutionEnvelope = z.infer<typeof codexExecutionEnvelopeSchema>

@Injectable()
export class HarnessWorkerCodexRunnerService {
  private readonly codexTimeoutMs: number

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly devpodService: HarnessWorkerDevpodService,
  ) {
    this.codexTimeoutMs = this.getPositiveInteger('HARNESS_WORKER_CODEX_TIMEOUT_MS', DEFAULT_CODEX_TIMEOUT_MS)
  }

  async resolveWorkspaceRoot(issueId: number): Promise<string> {
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

  async loadCodexThreadId(issueId: number): Promise<string> {
    const worker = await this.prisma.client.harness_worker.findFirst({
      where: {
        issue_id: issueId,
      },
      select: {
        devpod_metadata: true,
      },
    })

    const metadata = this.asRecord(worker?.devpod_metadata)
    const codexMetadata = this.asRecord(metadata?.codex)
    const threadId = codexMetadata?.threadId

    if (typeof threadId !== 'string' || threadId.trim().length === 0) {
      throw new Error(`Codex thread id is not available for issue ${issueId}`)
    }

    return threadId.trim()
  }

  async runCodexWithSchema(input: {
    issueId: number
    outputJsonSchema: unknown
    prompt: string
    repoRoot: string
    resumeThreadId?: string
    workspaceName: string
    workflowLabel: string
  }): Promise<HarnessWorkerCodexRunResult> {
    const result = input.resumeThreadId
      ? await this.executeResumeCodexRun(
          input.workspaceName,
          input.repoRoot,
          input.prompt,
          input.resumeThreadId,
          input.outputJsonSchema,
          input.workflowLabel,
        )
      : await this.executeInitialCodexRun(
          input.workspaceName,
          input.repoRoot,
          input.prompt,
          input.outputJsonSchema,
          input.workflowLabel,
        )

    if (result.threadId) {
      await this.persistCodexThreadId(input.issueId, result.threadId)
    }

    if (!result.threadId) {
      throw new Error('Codex execution did not emit a thread.started event with a thread_id')
    }

    if (result.exitCode !== 0) {
      throw new Error(this.sanitizeCodexFailure(result))
    }

    if (result.finalMessage.trim().length === 0) {
      throw new Error(this.sanitizeCodexFailure(result, 'Codex execution completed without a final agent message.'))
    }

    return {
      finalMessage: result.finalMessage,
      threadId: result.threadId,
    }
  }

  private async executeInitialCodexRun(
    workspaceName: string,
    repoRoot: string,
    prompt: string,
    outputJsonSchema: unknown,
    workflowLabel: string,
  ): Promise<HarnessWorkerCodexExecutionEnvelope> {
    const schemaBase64 = Buffer.from(JSON.stringify(outputJsonSchema), 'utf8').toString('base64')
    const promptBase64 = Buffer.from(prompt, 'utf8').toString('base64')

    const result = await this.runWorkspaceCommandSafely(
      workspaceName,
      this.buildCodexCommandScript({
        command:
          'codex exec --json --dangerously-bypass-approvals-and-sandbox --output-schema "$tmpdir/output-schema.json" -o "$tmpdir/final-message.json" - < "$tmpdir/prompt.txt"',
        promptBase64,
        repoRoot,
        schemaBase64,
      }),
      `run ${workflowLabel} codex exec`,
    )

    return this.parseCodexExecutionResult(result.stdout)
  }

  private async executeResumeCodexRun(
    workspaceName: string,
    repoRoot: string,
    prompt: string,
    threadId: string,
    outputJsonSchema: unknown,
    workflowLabel: string,
  ): Promise<HarnessWorkerCodexExecutionEnvelope> {
    const schemaBase64 = Buffer.from(JSON.stringify(outputJsonSchema), 'utf8').toString('base64')
    const promptBase64 = Buffer.from(prompt, 'utf8').toString('base64')

    const result = await this.runWorkspaceCommandSafely(
      workspaceName,
      this.buildCodexCommandScript({
        command: `codex exec --output-schema "$tmpdir/output-schema.json" resume ${this.quoteShellArg(threadId)} --json --dangerously-bypass-approvals-and-sandbox -o "$tmpdir/final-message.json" - < "$tmpdir/prompt.txt"`,
        promptBase64,
        repoRoot,
        schemaBase64,
      }),
      `resume ${workflowLabel} codex exec`,
    )

    return this.parseCodexExecutionResult(result.stdout)
  }

  private async runWorkspaceCommandSafely(workspaceName: string, command: string, label: string) {
    try {
      return await this.devpodService.runWorkspaceCommand(workspaceName, command, {
        label,
        timeoutMs: this.codexTimeoutMs,
      })
    } catch (error) {
      throw new Error(this.sanitizeExecutionError(error))
    }
  }

  private parseCodexExecutionResult(rawOutput: string): HarnessWorkerCodexExecutionEnvelope {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawOutput.trim())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Codex execution result is not valid JSON: ${message}`)
    }

    const result = codexExecutionEnvelopeSchema.safeParse(parsed)
    if (!result.success) {
      throw new Error(result.error.issues.map(issue => issue.message).join('; '))
    }

    return result.data
  }

  private buildCodexCommandScript(input: {
    command: string
    promptBase64: string
    repoRoot: string
    schemaBase64?: string
  }): string {
    const lines = ['set -eu', 'tmpdir="$(mktemp -d)"', 'trap \'rm -rf "$tmpdir"\' EXIT']

    if (input.schemaBase64) {
      lines.push(`printf '%s' ${this.quoteShellArg(input.schemaBase64)} | base64 -d > "$tmpdir/output-schema.json"`)
    }

    lines.push(
      `printf '%s' ${this.quoteShellArg(input.promptBase64)} | base64 -d > "$tmpdir/prompt.txt"`,
      `cd ${this.quoteShellArg(input.repoRoot)}`,
      'set +e',
      `${input.command} > "$tmpdir/events.jsonl" 2> "$tmpdir/codex-stderr.log"`,
      'codex_exit_code="$?"',
      'set -e',
      'node - "$tmpdir/events.jsonl" "$tmpdir/final-message.json" "$tmpdir/codex-stderr.log" "$codex_exit_code" <<\'NODE\'',
      "const fs = require('fs')",
      'const [eventsPath, finalPath, stderrPath, exitCodeRaw] = process.argv.slice(2)',
      "const lines = fs.readFileSync(eventsPath, 'utf8').split(/\\r?\\n/).map(line => line.trim()).filter(Boolean)",
      'let threadId = null',
      'const errorMessages = []',
      'for (const line of lines) {',
      '  try {',
      '    const event = JSON.parse(line)',
      "    if (event && event.type === 'thread.started' && typeof event.thread_id === 'string' && event.thread_id.trim().length > 0) {",
      '      threadId = event.thread_id.trim()',
      '    }',
      "    if (event && event.type === 'error' && typeof event.message === 'string' && event.message.trim().length > 0) {",
      '      errorMessages.push(event.message.trim())',
      '    }',
      "    if (event && event.type === 'turn.failed' && event.error && typeof event.error.message === 'string' && event.error.message.trim().length > 0) {",
      '      errorMessages.push(event.error.message.trim())',
      '    }',
      '  } catch (_error) {',
      '    continue',
      '  }',
      '}',
      "const finalMessage = fs.existsSync(finalPath) ? fs.readFileSync(finalPath, 'utf8') : ''",
      "const codexStderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, 'utf8') : ''",
      'const exitCode = Number.parseInt(String(exitCodeRaw), 10)',
      'process.stdout.write(JSON.stringify({ threadId, finalMessage, exitCode: Number.isFinite(exitCode) ? exitCode : 1, errorMessages, codexStderr }))',
      'NODE',
    )

    return lines.join('\n')
  }

  private async persistCodexThreadId(issueId: number, threadId: string): Promise<void> {
    const normalizedThreadId = threadId.trim()
    if (normalizedThreadId.length === 0) {
      return
    }

    const worker = await this.prisma.client.harness_worker.findFirst({
      where: {
        issue_id: issueId,
      },
      select: {
        devpod_metadata: true,
      },
    })

    if (!worker) {
      return
    }

    const metadata = this.asRecord(worker.devpod_metadata) ?? {}
    const codexMetadata = this.asRecord(metadata.codex) ?? {}
    const nextMetadata = {
      ...metadata,
      codex: {
        ...codexMetadata,
        threadId: normalizedThreadId,
      },
    }

    await this.prisma.client.harness_worker.updateMany({
      where: {
        issue_id: issueId,
      },
      data: {
        devpod_metadata: nextMetadata as Prisma.InputJsonValue,
      },
    })
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

  private sanitizeExecutionError(error: unknown): string {
    const preferredMessage =
      this.extractProcessOutput(error) || (error instanceof Error ? error.message : String(error))
    const sensitiveValues = this.getSensitiveValues()
    const redactedMessage = sensitiveValues.reduce((message, sensitiveValue) => {
      if (!sensitiveValue) {
        return message
      }

      return message.split(sensitiveValue).join('***')
    }, preferredMessage)

    const normalizedLines = this.stripAnsi(redactedMessage)
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => !line.includes('Error tunneling to container'))
      .filter(line => !line.startsWith('Command failed:'))

    const sanitizedMessage =
      normalizedLines.slice(-8).join('\n').trim() || 'Workspace command failed without a usable stderr payload.'

    return this.truncateFromEnd(sanitizedMessage, 1_000)
  }

  private sanitizeCodexFailure(execution: HarnessWorkerCodexExecutionEnvelope, fallbackMessage?: string): string {
    const sensitiveValues = this.getSensitiveValues()
    const redactedCodexStderr = sensitiveValues.reduce((message, sensitiveValue) => {
      if (!sensitiveValue) {
        return message
      }

      return message.split(sensitiveValue).join('***')
    }, execution.codexStderr)

    const normalizedMessages = [
      ...execution.errorMessages,
      ...this.stripAnsi(redactedCodexStderr)
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .filter(line => !line.includes('Warning: no last agent message')),
    ]

    const uniqueMessages = [...new Set(normalizedMessages)]
    const message =
      uniqueMessages.join('\n').trim() ||
      fallbackMessage ||
      (execution.exitCode !== 0
        ? `Codex execution exited with status ${execution.exitCode}.`
        : 'Codex execution completed without a final agent message.')

    return this.truncateFromEnd(message, 1_000)
  }

  private getSensitiveValues(): string[] {
    return [this.configService.get<string>('CODEX_AUTH_JSON')?.trim()].filter(
      (value, index, values): value is string =>
        typeof value === 'string' && value.length > 0 && values.indexOf(value) === index,
    )
  }

  private extractProcessOutput(error: unknown): string {
    return this.extractCommandStream(error, 'stderr') || this.extractCommandStream(error, 'stdout')
  }

  private extractCommandStream(error: unknown, key: 'stderr' | 'stdout'): string {
    if (!error || typeof error !== 'object' || !(key in error)) {
      return ''
    }

    const streamValue = (error as { stderr?: unknown; stdout?: unknown })[key]
    if (typeof streamValue === 'string') {
      return streamValue
    }

    return Buffer.isBuffer(streamValue) ? streamValue.toString('utf8') : ''
  }

  private stripAnsi(value: string): string {
    return value.replace(/\u001b\[[0-9;]*m/g, '')
  }

  private truncateFromEnd(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value
    }

    return `...${value.slice(value.length - maxLength + 3)}`
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
}
