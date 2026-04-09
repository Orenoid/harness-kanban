import { z } from 'zod'

import { Injectable } from '@nestjs/common'
import { ClaudeCodeCodingAgentSettings } from '@repo/shared'
import { ProjectMcpConfig, ProjectMcpServerConfig } from '@repo/shared/project/types'
import { HarnessWorkerToolchainService } from '../toolchain.service'
import {
  DevpodCommandResult,
  HarnessWorkerCodingAgentProvider,
  HarnessWorkerCodingAgentRunContext,
  HarnessWorkerCodingAgentRunResult,
  HarnessWorkerCodingAgentWorkspacePreparationContext,
  WorkspaceCommandOptions,
} from './coding-agent-provider.types'

const CLAUDE_MCP_CONFIG_PATH = '$HOME/.harness-kanban/providers/claude-code/mcp.json'
const CLAUDE_MCP_TIMEOUT_MS = 30_000

const claudeExecutionEnvelopeSchema = z.object({
  claudeStderr: z.string(),
  errorMessages: z.array(z.string()),
  exitCode: z.number().int(),
  finalMessage: z.string(),
  sessionId: z.string().trim().min(1).nullable(),
})

type HarnessWorkerClaudeExecutionEnvelope = z.infer<typeof claudeExecutionEnvelopeSchema>

@Injectable()
export class HarnessWorkerClaudeCodeProvider implements HarnessWorkerCodingAgentProvider<'claude-code'> {
  readonly type = 'claude-code' as const

  constructor(private readonly toolchainService: HarnessWorkerToolchainService) {}

  getSensitiveValues(settings: ClaudeCodeCodingAgentSettings): string[] {
    return settings.apiKey.trim().length > 0 ? [settings.apiKey] : []
  }

  async prepareWorkspace(context: HarnessWorkerCodingAgentWorkspacePreparationContext<'claude-code'>): Promise<void> {
    const artifact = await this.toolchainService.resolveToolchainArtifact(this.type, context.platform)

    await context.injectToolchainArtifact(artifact)
    await this.syncWorkspaceAssetsToRemoteUser(context)
    await this.seedClaudeOnboardingState(context)
    await this.writeClaudeMcpConfig(context)
  }

  async runWithSchema(
    context: HarnessWorkerCodingAgentRunContext<'claude-code'>,
  ): Promise<HarnessWorkerCodingAgentRunResult> {
    const schemaBase64 = Buffer.from(JSON.stringify(context.outputJsonSchema), 'utf8').toString('base64')
    const promptBase64 = Buffer.from(context.prompt, 'utf8').toString('base64')

    const result = await this.runWorkspaceCommandSafely(
      context,
      this.buildClaudeCommandScript(context, {
        promptBase64,
        repoRoot: context.repoRoot,
        resumeSessionId: context.resumeSessionId,
        schemaBase64,
      }),
      `${context.resumeSessionId ? 'resume' : 'run'} ${context.workflowLabel} claude exec`,
    )

    const execution = this.parseClaudeExecutionResult(result.stdout)

    if (!execution.sessionId) {
      throw new Error('Claude Code execution did not return a session_id.')
    }

    if (execution.exitCode !== 0) {
      throw new Error(this.sanitizeClaudeFailure(execution, context.settings))
    }

    if (execution.finalMessage.trim().length === 0) {
      throw new Error(
        this.sanitizeClaudeFailure(
          execution,
          context.settings,
          'Claude Code execution completed without a structured output payload.',
        ),
      )
    }

    return {
      finalMessage: execution.finalMessage,
      sessionId: execution.sessionId,
    }
  }

  private async seedClaudeOnboardingState(
    context: HarnessWorkerCodingAgentWorkspacePreparationContext<'claude-code'>,
  ): Promise<void> {
    const command = [
      'set -eu',
      "node <<'NODE'",
      "const fs = require('fs')",
      "const os = require('os')",
      "const path = require('path')",
      "const filePath = path.join(os.homedir(), '.claude.json')",
      'let content = {}',
      'if (fs.existsSync(filePath)) {',
      "  content = JSON.parse(fs.readFileSync(filePath, 'utf8'))",
      '}',
      'content.hasCompletedOnboarding = true',
      "fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8')",
      'NODE',
    ].join('\n')

    await this.executeWorkspaceCommandAsClaudeUser(
      context.remoteUser,
      context.executeWorkspaceCommand,
      context.quoteShellArg,
      command,
      {
        label: 'seed Claude Code onboarding state',
        maxBuffer: 10 * 1024 * 1024,
      },
    )
  }

  private async writeClaudeMcpConfig(
    context: HarnessWorkerCodingAgentWorkspacePreparationContext<'claude-code'>,
  ): Promise<void> {
    const claudeMcpConfig = this.toClaudeMcpConfig(context.mcpConfig)
    const configDir = '$HOME/.harness-kanban/providers/claude-code'

    if (!claudeMcpConfig) {
      await this.executeWorkspaceCommandAsClaudeUser(
        context.remoteUser,
        context.executeWorkspaceCommand,
        context.quoteShellArg,
        `rm -f ${CLAUDE_MCP_CONFIG_PATH}`,
        {
          label: 'clear Claude Code MCP config',
          maxBuffer: 10 * 1024 * 1024,
        },
      )
      return
    }

    const configBase64 = Buffer.from(JSON.stringify(claudeMcpConfig, null, 2), 'utf8').toString('base64')
    await this.executeWorkspaceCommandAsClaudeUser(
      context.remoteUser,
      context.executeWorkspaceCommand,
      context.quoteShellArg,
      [
        'set -eu',
        `mkdir -p ${configDir}`,
        `printf '%s' ${context.quoteShellArg(configBase64)} | base64 -d > ${CLAUDE_MCP_CONFIG_PATH}`,
      ].join('\n'),
      {
        label: 'write Claude Code MCP config',
        maxBuffer: 10 * 1024 * 1024,
      },
    )
  }

  private toClaudeMcpConfig(mcpConfig: ProjectMcpConfig | null): { mcpServers: Record<string, unknown> } | null {
    if (!mcpConfig || Object.keys(mcpConfig).length === 0) {
      return null
    }

    return {
      mcpServers: Object.fromEntries(
        Object.entries(mcpConfig).map(([name, serverConfig]) => [name, this.toClaudeMcpServerConfig(serverConfig)]),
      ),
    }
  }

  private toClaudeMcpServerConfig(serverConfig: ProjectMcpServerConfig): Record<string, unknown> {
    if (serverConfig.type === 'streamable-http') {
      return {
        type: 'http',
        url: serverConfig.url,
      }
    }

    return {
      type: 'stdio',
      command: serverConfig.command,
      ...(serverConfig.args && serverConfig.args.length > 0 ? { args: serverConfig.args } : {}),
      ...(serverConfig.env && Object.keys(serverConfig.env).length > 0 ? { env: serverConfig.env } : {}),
    }
  }

  private async runWorkspaceCommandSafely(
    context: HarnessWorkerCodingAgentRunContext<'claude-code'>,
    command: string,
    label: string,
  ) {
    try {
      return await this.executeWorkspaceCommandAsClaudeUser(
        context.remoteUser,
        context.runWorkspaceCommand,
        context.quoteShellArg,
        command,
        {
          label,
          timeoutMs: context.timeoutMs,
        },
      )
    } catch (error) {
      throw new Error(this.sanitizeExecutionError(error, context.settings))
    }
  }

  private parseClaudeExecutionResult(rawOutput: string): HarnessWorkerClaudeExecutionEnvelope {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawOutput.trim())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Claude Code execution result is not valid JSON: ${message}`)
    }

    const result = claudeExecutionEnvelopeSchema.safeParse(parsed)
    if (!result.success) {
      throw new Error(result.error.issues.map(issue => issue.message).join('; '))
    }

    return result.data
  }

  private buildClaudeCommandScript(
    context: HarnessWorkerCodingAgentRunContext<'claude-code'>,
    input: {
      promptBase64: string
      repoRoot: string
      resumeSessionId?: string
      schemaBase64: string
    },
  ): string {
    const canSkipPermissions = Boolean(context.remoteUser && context.remoteUser !== 'root')
    const lines = [
      'set -eu',
      'if [ -f "$HOME/.harness-kanban/path.sh" ]; then',
      '  . "$HOME/.harness-kanban/path.sh"',
      'else',
      '  PATH="$HOME/.harness-kanban/bin:$PATH"',
      '  export PATH',
      'fi',
      `export ANTHROPIC_API_KEY=${context.quoteShellArg(context.settings.apiKey)}`,
      `export ANTHROPIC_BASE_URL=${context.quoteShellArg(context.settings.baseUrl)}`,
      "export ENABLE_TOOL_SEARCH='false'",
      'tmpdir="$(mktemp -d)"',
      'trap \'rm -rf "$tmpdir"\' EXIT',
      `printf '%s' ${context.quoteShellArg(input.schemaBase64)} | base64 -d > "$tmpdir/output-schema.json"`,
      `printf '%s' ${context.quoteShellArg(input.promptBase64)} | base64 -d > "$tmpdir/prompt.txt"`,
      `cd ${context.quoteShellArg(input.repoRoot)}`,
      'set -- claude -p "$(cat "$tmpdir/prompt.txt")" --output-format json --json-schema "$(cat "$tmpdir/output-schema.json")" --model ' +
        `${context.quoteShellArg(context.settings.model)}`,
      `if [ -f ${CLAUDE_MCP_CONFIG_PATH} ]; then`,
      `  export MCP_TIMEOUT=${context.quoteShellArg(String(CLAUDE_MCP_TIMEOUT_MS))}`,
      `  set -- "$@" --mcp-config ${CLAUDE_MCP_CONFIG_PATH} --strict-mcp-config`,
      'fi',
    ]

    if (canSkipPermissions) {
      lines.push('set -- "$@" --dangerously-skip-permissions')
    }

    if (input.resumeSessionId) {
      lines.push(`set -- "$@" --resume ${context.quoteShellArg(input.resumeSessionId)}`)
    }

    lines.push(
      'set +e',
      '"$@" < /dev/null > "$tmpdir/claude-output.json" 2> "$tmpdir/claude-stderr.log"',
      'claude_exit_code="$?"',
      'set -e',
      'node - "$tmpdir/claude-output.json" "$tmpdir/claude-stderr.log" "$claude_exit_code" <<\'NODE\'',
      "const fs = require('fs')",
      'const [outputPath, stderrPath, exitCodeRaw] = process.argv.slice(2)',
      'const errorMessages = []',
      'let finalMessage = ""',
      'let sessionId = null',
      'if (fs.existsSync(outputPath)) {',
      '  const rawOutput = fs.readFileSync(outputPath, "utf8").trim()',
      '  if (rawOutput.length > 0) {',
      '    try {',
      '      const payload = JSON.parse(rawOutput)',
      '      if (payload && typeof payload.session_id === "string" && payload.session_id.trim().length > 0) {',
      '        sessionId = payload.session_id.trim()',
      '      }',
      '      if (payload && Object.prototype.hasOwnProperty.call(payload, "structured_output")) {',
      '        finalMessage = JSON.stringify(payload.structured_output)',
      '      } else if (payload && typeof payload.result === "string") {',
      '        finalMessage = payload.result',
      '      } else if (payload && Object.prototype.hasOwnProperty.call(payload, "result")) {',
      '        finalMessage = JSON.stringify(payload.result)',
      '      }',
      '      if (payload && typeof payload.error === "string" && payload.error.trim().length > 0) {',
      '        errorMessages.push(payload.error.trim())',
      '      }',
      '    } catch (error) {',
      '      errorMessages.push(`Failed to parse Claude Code JSON output: ${error instanceof Error ? error.message : String(error)}`)',
      '    }',
      '  }',
      '}',
      'const claudeStderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf8") : ""',
      'const exitCode = Number.parseInt(String(exitCodeRaw), 10)',
      'process.stdout.write(JSON.stringify({ sessionId, finalMessage, exitCode: Number.isFinite(exitCode) ? exitCode : 1, errorMessages, claudeStderr }))',
      'NODE',
    )

    return lines.join('\n')
  }

  private async syncWorkspaceAssetsToRemoteUser(
    context: HarnessWorkerCodingAgentWorkspacePreparationContext<'claude-code'>,
  ): Promise<void> {
    if (!context.remoteUser) {
      return
    }

    await context.executeWorkspaceCommand(
      [
        'set -eu',
        `remote_user=${context.quoteShellArg(context.remoteUser)}`,
        'remote_home="$(getent passwd "$remote_user" | cut -d: -f6)"',
        'if [ -z "$remote_home" ]; then',
        '  echo "Claude Code remote user home could not be resolved." >&2',
        '  exit 1',
        'fi',
        'mkdir -p "$remote_home"',
        'rm -rf "$remote_home/.harness-kanban"',
        'mkdir -p "$remote_home/.harness-kanban"',
        'if [ -d "$HOME/.harness-kanban" ]; then',
        '  cp -R "$HOME/.harness-kanban/." "$remote_home/.harness-kanban/"',
        'fi',
        'remote_toolchain_dir="$remote_home/.harness-kanban/toolchains/claude-code"',
        'if [ -L "$remote_toolchain_dir/current" ]; then',
        '  current_target="$(readlink "$remote_toolchain_dir/current")"',
        '  version_name="$(basename "$current_target")"',
        '  if [ -n "$version_name" ] && [ -d "$remote_toolchain_dir/$version_name" ]; then',
        '    ln -sfn "$remote_toolchain_dir/$version_name" "$remote_toolchain_dir/current"',
        '  fi',
        'fi',
        'if [ -f "$HOME/.gitconfig" ]; then',
        '  cp "$HOME/.gitconfig" "$remote_home/.gitconfig"',
        'fi',
        'chown -R "$remote_user:$remote_user" "$remote_home/.harness-kanban"',
        'if [ -f "$remote_home/.gitconfig" ]; then',
        '  chown "$remote_user:$remote_user" "$remote_home/.gitconfig"',
        'fi',
        `profile_line=${context.quoteShellArg('. "$HOME/.harness-kanban/path.sh"')}`,
        'for rc_path in "$remote_home/.profile" "$remote_home/.bash_profile" "$remote_home/.bashrc" "$remote_home/.zprofile" "$remote_home/.zshrc"; do',
        '  touch "$rc_path"',
        '  if ! grep -Fqx "$profile_line" "$rc_path" 2>/dev/null; then',
        '    printf "\\n%s\\n" "$profile_line" >> "$rc_path"',
        '  fi',
        '  chown "$remote_user:$remote_user" "$rc_path"',
        'done',
      ].join('\n'),
      {
        label: 'sync Claude Code assets to remote user',
        maxBuffer: 10 * 1024 * 1024,
      },
    )
  }

  private async executeWorkspaceCommandAsClaudeUser(
    remoteUser: string | null,
    executeWorkspaceCommand: (command: string, options?: WorkspaceCommandOptions) => Promise<DevpodCommandResult>,
    quoteShellArg: (value: string) => string,
    command: string,
    options?: WorkspaceCommandOptions,
  ): Promise<DevpodCommandResult> {
    if (!remoteUser) {
      return executeWorkspaceCommand(command, options)
    }

    return executeWorkspaceCommand(this.buildRunAsUserCommand(remoteUser, quoteShellArg, command), options)
  }

  private buildRunAsUserCommand(remoteUser: string, quoteShellArg: (value: string) => string, command: string): string {
    const shellCommand = `sh -lc ${quoteShellArg(command)}`

    return [
      'set -eu',
      `target_user=${quoteShellArg(remoteUser)}`,
      'if ! getent passwd "$target_user" >/dev/null; then',
      '  echo "Claude Code remote user does not exist in the workspace." >&2',
      '  exit 1',
      'fi',
      `su -l "$target_user" -c ${quoteShellArg(shellCommand)}`,
    ].join('\n')
  }

  private sanitizeExecutionError(error: unknown, settings: ClaudeCodeCodingAgentSettings): string {
    const preferredMessage =
      this.extractProcessOutput(error) || (error instanceof Error ? error.message : String(error))
    const redactedMessage = this.getSensitiveValues(settings).reduce((message, sensitiveValue) => {
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

  private sanitizeClaudeFailure(
    execution: HarnessWorkerClaudeExecutionEnvelope,
    settings: ClaudeCodeCodingAgentSettings,
    fallbackMessage?: string,
  ): string {
    const redactedClaudeStderr = this.getSensitiveValues(settings).reduce((message, sensitiveValue) => {
      if (!sensitiveValue) {
        return message
      }

      return message.split(sensitiveValue).join('***')
    }, execution.claudeStderr)

    const normalizedClaudeStderr = this.stripAnsi(redactedClaudeStderr)
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)

    const normalizedErrorMessages = execution.errorMessages
      .map(message => this.stripAnsi(message).trim())
      .filter(message => message.length > 0)

    const combinedMessages = [...normalizedErrorMessages, ...normalizedClaudeStderr]
    const sanitizedMessage =
      combinedMessages.slice(-8).join('\n').trim() ||
      fallbackMessage ||
      `Claude Code exited with code ${execution.exitCode} without returning a usable error message.`

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
