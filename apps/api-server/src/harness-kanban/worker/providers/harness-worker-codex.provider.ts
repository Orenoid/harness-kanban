import { z } from 'zod'

import { Injectable } from '@nestjs/common'
import { CodexCodingAgentSettings } from '@repo/shared'
import { ProjectMcpServerConfig } from '@repo/shared/project/types'
import { HarnessWorkerToolchainService } from '../toolchain.service'
import {
  HarnessWorkerCodingAgentProvider,
  HarnessWorkerCodingAgentRunContext,
  HarnessWorkerCodingAgentRunResult,
  HarnessWorkerCodingAgentWorkspacePreparationContext,
} from './coding-agent-provider.types'

const codexExecutionEnvelopeSchema = z.object({
  codexStderr: z.string(),
  errorMessages: z.array(z.string()),
  exitCode: z.number().int(),
  finalMessage: z.string(),
  sessionId: z.string().trim().min(1).nullable(),
})

const CODEX_MCP_STDIO_STARTUP_TIMEOUT_SECONDS = 30

type HarnessWorkerCodexExecutionEnvelope = z.infer<typeof codexExecutionEnvelopeSchema>

@Injectable()
export class HarnessWorkerCodexProvider implements HarnessWorkerCodingAgentProvider<'codex'> {
  readonly type = 'codex' as const

  constructor(private readonly toolchainService: HarnessWorkerToolchainService) {}

  getSensitiveValues(settings: CodexCodingAgentSettings): string[] {
    const values = settings.authMode === 'auth-json' ? [JSON.stringify(settings.authJson)] : [settings.apiKey]

    return values.filter((value, index, collection) => value.length > 0 && collection.indexOf(value) === index)
  }

  async prepareWorkspace(context: HarnessWorkerCodingAgentWorkspacePreparationContext<'codex'>): Promise<void> {
    const artifact = await this.toolchainService.resolveToolchainArtifact(this.type, context.platform)

    await context.injectToolchainArtifact(artifact)

    if (context.settings.authMode === 'auth-json') {
      const codexAuthJsonBase64 = Buffer.from(JSON.stringify(context.settings.authJson), 'utf8').toString('base64')
      await context.executeWorkspaceCommand(
        `mkdir -p ~/.codex && printf %s ${context.quoteShellArg(codexAuthJsonBase64)} | base64 -d > ~/.codex/auth.json`,
        {
          label: 'seed Codex auth.json',
          maxBuffer: 10 * 1024 * 1024,
        },
      )
    }

    await this.configureWorkspaceCodexMcp(context)
  }

  async runWithSchema(
    context: HarnessWorkerCodingAgentRunContext<'codex'>,
  ): Promise<HarnessWorkerCodingAgentRunResult> {
    const result = context.resumeSessionId
      ? await this.executeResumeRun(context)
      : await this.executeInitialRun(context)

    if (!result.sessionId) {
      throw new Error('Codex execution did not emit a thread.started event with a thread_id.')
    }

    if (result.exitCode !== 0) {
      throw new Error(this.sanitizeCodexFailure(result, context.settings))
    }

    if (result.finalMessage.trim().length === 0) {
      throw new Error(
        this.sanitizeCodexFailure(result, context.settings, 'Codex execution completed without a final agent message.'),
      )
    }

    return {
      finalMessage: result.finalMessage,
      sessionId: result.sessionId,
    }
  }

  private async executeInitialRun(
    context: HarnessWorkerCodingAgentRunContext<'codex'>,
  ): Promise<HarnessWorkerCodexExecutionEnvelope> {
    const schemaBase64 = Buffer.from(JSON.stringify(context.outputJsonSchema), 'utf8').toString('base64')
    const promptBase64 = Buffer.from(context.prompt, 'utf8').toString('base64')

    const result = await this.runWorkspaceCommandSafely(
      context,
      this.buildCodexCommandScript(context, {
        command: `${this.buildCodexExecCommand(context.settings, context.quoteShellArg)} --json --dangerously-bypass-approvals-and-sandbox --output-schema "$tmpdir/output-schema.json" -o "$tmpdir/final-message.json" - < "$tmpdir/prompt.txt"`,
        promptBase64,
        repoRoot: context.repoRoot,
        schemaBase64,
      }),
      `run ${context.workflowLabel} codex exec`,
    )

    return this.parseCodexExecutionResult(result.stdout)
  }

  private async executeResumeRun(
    context: HarnessWorkerCodingAgentRunContext<'codex'>,
  ): Promise<HarnessWorkerCodexExecutionEnvelope> {
    const schemaBase64 = Buffer.from(JSON.stringify(context.outputJsonSchema), 'utf8').toString('base64')
    const promptBase64 = Buffer.from(context.prompt, 'utf8').toString('base64')

    const result = await this.runWorkspaceCommandSafely(
      context,
      this.buildCodexCommandScript(context, {
        command: `${this.buildCodexExecCommand(context.settings, context.quoteShellArg)} --output-schema "$tmpdir/output-schema.json" resume ${context.quoteShellArg(context.resumeSessionId ?? '')} --json --dangerously-bypass-approvals-and-sandbox -o "$tmpdir/final-message.json" - < "$tmpdir/prompt.txt"`,
        promptBase64,
        repoRoot: context.repoRoot,
        schemaBase64,
      }),
      `resume ${context.workflowLabel} codex exec`,
    )

    return this.parseCodexExecutionResult(result.stdout)
  }

  private async runWorkspaceCommandSafely(
    context: HarnessWorkerCodingAgentRunContext<'codex'>,
    command: string,
    label: string,
  ) {
    const forwardEnv = context.settings.authMode === 'api-key' ? { CODEX_API_KEY: context.settings.apiKey } : undefined

    try {
      return await context.runWorkspaceCommand(command, {
        forwardEnv,
        label,
        timeoutMs: context.timeoutMs,
      })
    } catch (error) {
      throw new Error(this.sanitizeExecutionError(error, context.settings))
    }
  }

  private async configureWorkspaceCodexMcp(
    context: HarnessWorkerCodingAgentWorkspacePreparationContext<'codex'>,
  ): Promise<void> {
    if (!context.mcpConfig || Object.keys(context.mcpConfig).length === 0) {
      return
    }

    const mcpConfigEntries = Object.entries(context.mcpConfig)
    const commands = mcpConfigEntries.flatMap(([name, serverConfig]) => [
      `"$HOME/.harness-kanban/bin/codex" mcp remove ${context.quoteShellArg(name)} >/dev/null 2>&1 || true`,
      this.buildCodexMcpAddCommand(name, serverConfig, context.quoteShellArg),
    ])
    const stdioServerNames = mcpConfigEntries
      .filter(([, serverConfig]) => serverConfig.type === 'stdio')
      .map(([name]) => name)

    if (stdioServerNames.length > 0) {
      // need to set a longer startup timeout, otherwise some mcp servers may fail to start in non-interactive mode
      commands.push(this.buildCodexMcpStartupTimeoutCommand(stdioServerNames, context.quoteShellArg))
    }

    await context.executeWorkspaceCommand(['set -eu', ...commands].join('\n'), {
      label: 'configure Codex MCP servers',
      maxBuffer: 10 * 1024 * 1024,
    })
  }

  private buildCodexMcpAddCommand(
    name: string,
    serverConfig: ProjectMcpServerConfig,
    quoteShellArg: (value: string) => string,
  ): string {
    if (serverConfig.type === 'streamable-http') {
      return `"$HOME/.harness-kanban/bin/codex" mcp add ${quoteShellArg(name)} --url ${quoteShellArg(serverConfig.url)}`
    }

    const envArgs = Object.entries(serverConfig.env ?? {}).flatMap(([key, value]) => ['--env', `${key}=${value}`])
    const quotedEnvArgs = envArgs.map(value => quoteShellArg(value)).join(' ')
    const quotedCommandArgs = [serverConfig.command, ...(serverConfig.args ?? [])]
      .map(value => quoteShellArg(value))
      .join(' ')

    return [`"$HOME/.harness-kanban/bin/codex" mcp add ${quoteShellArg(name)}`, quotedEnvArgs, '--', quotedCommandArgs]
      .filter(Boolean)
      .join(' ')
  }

  private buildCodexMcpStartupTimeoutCommand(
    stdioServerNames: string[],
    quoteShellArg: (value: string) => string,
  ): string {
    const namesJson = JSON.stringify(stdioServerNames)
    const timeout = String(CODEX_MCP_STDIO_STARTUP_TIMEOUT_SECONDS)

    return [
      `node - ${quoteShellArg(namesJson)} ${quoteShellArg(timeout)} <<'NODE'`,
      "const fs = require('fs')",
      'const configPath = `${process.env.HOME}/.codex/config.toml`',
      'const [namesJson, timeoutRaw] = process.argv.slice(2)',
      'const names = JSON.parse(namesJson)',
      'let config = fs.readFileSync(configPath, "utf8")',
      'const escapeRegExp = value => value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")',
      'for (const name of names) {',
      '  const sectionPattern = new RegExp(`(\\\\[mcp_servers\\\\.${escapeRegExp(name)}\\\\]\\\\n)([\\\\s\\\\S]*?)(?=\\\\n\\\\[|$)`)',
      '  config = config.replace(sectionPattern, (section, header, body) => {',
      '    if (/^startup_timeout_sec\\s*=\\s*/m.test(body)) {',
      '      return section',
      '    }',
      '    const separator = body.endsWith("\\n") || body.length === 0 ? "" : "\\n"',
      '    return `${header}${body}${separator}startup_timeout_sec = ${timeoutRaw}\\n`',
      '  })',
      '}',
      'fs.writeFileSync(configPath, config)',
      'NODE',
    ].join('\n')
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

  private buildCodexCommandScript(
    context: HarnessWorkerCodingAgentRunContext<'codex'>,
    input: {
      command: string
      promptBase64: string
      repoRoot: string
      schemaBase64?: string
    },
  ): string {
    const lines = ['set -eu', 'tmpdir="$(mktemp -d)"', 'trap \'rm -rf "$tmpdir"\' EXIT']

    if (input.schemaBase64) {
      lines.push(`printf '%s' ${context.quoteShellArg(input.schemaBase64)} | base64 -d > "$tmpdir/output-schema.json"`)
    }

    lines.push(
      `printf '%s' ${context.quoteShellArg(input.promptBase64)} | base64 -d > "$tmpdir/prompt.txt"`,
      `cd ${context.quoteShellArg(input.repoRoot)}`,
      'set +e',
      `${input.command} > "$tmpdir/events.jsonl" 2> "$tmpdir/codex-stderr.log"`,
      'codex_exit_code="$?"',
      'set -e',
      'node - "$tmpdir/events.jsonl" "$tmpdir/final-message.json" "$tmpdir/codex-stderr.log" "$codex_exit_code" <<\'NODE\'',
      "const fs = require('fs')",
      'const [eventsPath, finalPath, stderrPath, exitCodeRaw] = process.argv.slice(2)',
      "const lines = fs.readFileSync(eventsPath, 'utf8').split(/\\r?\\n/).map(line => line.trim()).filter(Boolean)",
      'let sessionId = null',
      'const errorMessages = []',
      'for (const line of lines) {',
      '  try {',
      '    const event = JSON.parse(line)',
      "    if (event && event.type === 'thread.started' && typeof event.thread_id === 'string' && event.thread_id.trim().length > 0) {",
      '      sessionId = event.thread_id.trim()',
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
      'process.stdout.write(JSON.stringify({ sessionId, finalMessage, exitCode: Number.isFinite(exitCode) ? exitCode : 1, errorMessages, codexStderr }))',
      'NODE',
    )

    return lines.join('\n')
  }

  private buildCodexExecCommand(settings: CodexCodingAgentSettings, quoteShellArg: (value: string) => string): string {
    const args = [
      'codex',
      'exec',
      '-m',
      settings.model,
      '--config',
      `model_reasoning_effort=${JSON.stringify(settings.reasoningEffort)}`,
    ]

    return args.map(value => (value === 'codex' || value === 'exec' ? value : quoteShellArg(value))).join(' ')
  }

  private sanitizeExecutionError(error: unknown, settings: CodexCodingAgentSettings): string {
    const preferredMessage =
      this.extractProcessOutput(error) || (error instanceof Error ? error.message : String(error))
    const sensitiveValues = this.getSensitiveValues(settings)
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

  private sanitizeCodexFailure(
    execution: HarnessWorkerCodexExecutionEnvelope,
    settings: CodexCodingAgentSettings,
    fallbackMessage?: string,
  ): string {
    const sensitiveValues = this.getSensitiveValues(settings)
    const redactedCodexStderr = sensitiveValues.reduce((message, sensitiveValue) => {
      if (!sensitiveValue) {
        return message
      }

      return message.split(sensitiveValue).join('***')
    }, execution.codexStderr)

    const normalizedCodexStderr = this.stripAnsi(redactedCodexStderr)
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)

    const normalizedErrorMessages = execution.errorMessages
      .map(message => this.stripAnsi(message).trim())
      .filter(message => message.length > 0)

    const combinedMessages = [...normalizedErrorMessages, ...normalizedCodexStderr]
    const sanitizedMessage =
      combinedMessages.slice(-8).join('\n').trim() ||
      fallbackMessage ||
      `Codex exited with code ${execution.exitCode} without returning a usable error message.`

    return this.truncateFromEnd(sanitizedMessage, 1_000)
  }

  private extractProcessOutput(error: unknown): string {
    if (!error || typeof error !== 'object') {
      return ''
    }

    const candidate = error as { stderr?: unknown; stdout?: unknown; output?: unknown }
    const stderr = typeof candidate.stderr === 'string' ? candidate.stderr : ''
    const stdout = typeof candidate.stdout === 'string' ? candidate.stdout : ''
    const output =
      Array.isArray(candidate.output) && candidate.output.length > 0
        ? candidate.output
            .map(value => (typeof value === 'string' ? value : ''))
            .filter(Boolean)
            .join('\n')
        : ''

    return [stderr, stdout, output].find(value => value.trim().length > 0) ?? ''
  }

  private stripAnsi(value: string): string {
    return value.replace(/\u001B\[[0-9;]*m/g, '')
  }

  private truncateFromEnd(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : value.slice(value.length - maxLength)
  }
}
