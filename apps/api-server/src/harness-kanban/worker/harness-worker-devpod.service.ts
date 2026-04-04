import { execFile, spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CodingAgentService } from '@/coding-agent/coding-agent.service'
import { PrismaService } from '@/database/prisma.service'
import { GithubService } from '@/github/github.service'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@repo/database'
import { normalizeGithubRepoUrl } from '@repo/shared'
import {
  parseProjectEnvConfig,
  parseProjectMcpConfig,
  ProjectEnvConfig,
  ProjectMcpConfig,
  ProjectMcpServerConfig,
} from '@repo/shared/project/types'
import { SystemPropertyId } from '@repo/shared/property/constants'
import {
  getCodexAuthSensitiveValues,
  resolveCodexAuthConfig,
  ResolvedCodexAuthConfig,
} from './harness-worker-codex-auth'
import { HarnessWorkerToolchainService } from './harness-worker-toolchain.service'
import type { ExecFileOptions } from 'node:child_process'
import type { HarnessWorkerToolchainPlatform } from './harness-worker-toolchain.service'

type DevpodCommandResult = {
  stderr: string
  stdout: string
}

type WorkspaceCommandOptions = {
  forwardEnv?: Record<string, string>
  label?: string
  maxBuffer?: number
  timeoutMs?: number
}

type IssueProjectRepository = {
  envConfig: ProjectEnvConfig | null
  githubRepoUrl: string
  mcpConfig: ProjectMcpConfig | null
  projectId: string
  repoBaseBranch: string
}

type PreparedDockerConfigDirectory = {
  path: string
  temporary: boolean
}

type PreparedGitConfigFile = {
  path: string
  directory: string
  temporary: boolean
}

type DevpodWorkspaceSource = Partial<{
  gitRepository: string
  gitBranch: string
  gitCommit: string
  gitPRReference: string
  gitSubDir: string
  localFolder: string
  image: string
  container: string
}>

type DevpodWorkspaceRecord = {
  id?: string
  uid?: string
  provider?: {
    name?: string
  }
  ide?: {
    name?: string
  }
  source?: DevpodWorkspaceSource
  creationTimestamp?: string
  context?: string
}

type DevpodWorkspaceStatus = {
  state?: string
}

type DevpodWorkspaceResult = {
  DevContainerConfigWithPath?: {
    path?: string
  }
  MergedConfig?: {
    image?: string
    remoteUser?: string
  }
  SubstitutionContext?: {
    DevContainerID?: string
    ContainerWorkspaceFolder?: string
  }
  ContainerDetails?: {
    ID?: string
    Created?: string
    State?: {
      Status?: string
      StartedAt?: string
    }
  }
}

type HarnessWorkerDevpodMetadata = {
  workspace: {
    id: string | null
    uid: string | null
    provider: {
      name: string | null
    }
    ide: {
      name: string | null
    }
    source: DevpodWorkspaceSource | null
    creationTimestamp: string | null
  }
  status: {
    state: string | null
  }
  result: {
    devContainer: {
      path: string | null
    }
    merged: {
      image: string | null
      remoteUser: string | null
    }
    substitution: {
      devContainerId: string | null
      containerWorkspaceFolder: string | null
    }
    container: {
      id: string | null
      created: string | null
      state: {
        status: string | null
        startedAt: string | null
      }
    }
  }
}

const DEFAULT_DEVPOD_FALLBACK_IMAGE = 'mcr.microsoft.com/devcontainers/base:ubuntu'
const DEFAULT_GIT_CREDENTIAL_USERNAME = 'x-access-token'
const DEFAULT_GIT_COMMIT_EMAIL = 'bot_code_bot@harness-kanban.local'
const DEFAULT_GIT_COMMIT_NAME = 'Code Bot'
const PASSTHROUGH_ENV_KEYS = [
  'DEVPOD_HOME',
  'DOCKER_CERT_PATH',
  'DOCKER_HOST',
  'DOCKER_TLS_VERIFY',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TMPDIR',
  'USER',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
] as const

@Injectable()
export class HarnessWorkerDevpodService {
  private readonly logger = new Logger(HarnessWorkerDevpodService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly codingAgentService: CodingAgentService,
    private readonly toolchainService: HarnessWorkerToolchainService,
    private readonly githubService: GithubService,
  ) {}

  getWorkspaceNameForIssue(issueId: number): string {
    return this.buildWorkspaceName(issueId)
  }

  async createWorkspaceForIssue(issueId: number, workspaceId: string): Promise<string | null> {
    const repository = await this.getIssueProjectRepository(issueId, workspaceId)
    if (!repository) {
      this.logger.error(
        `Cannot create DevPod workspace for issue ${issueId}: project repository configuration is missing`,
      )
      return null
    }

    let token: string
    try {
      token = await this.githubService.getTokenForWorkspace(workspaceId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Cannot create DevPod workspace for issue ${issueId}: ${message}`)
      return null
    }

    let codexAuthConfig: ResolvedCodexAuthConfig | null = null
    try {
      codexAuthConfig = await resolveCodexAuthConfig(this.codingAgentService, issueId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`Cannot create DevPod workspace for issue ${issueId}: failed to load Codex auth: ${message}`)
      return null
    }

    if (!codexAuthConfig) {
      this.logger.error(
        `Cannot create DevPod workspace for issue ${issueId}: no usable Codex coding agent is configured`,
      )
      return null
    }

    const workspaceName = this.buildWorkspaceName(issueId)
    const cloneUrl = this.normalizeCloneUrl(repository.githubRepoUrl)
    const dockerConfigDirectory = await this.prepareDockerConfigDirectory()
    const gitConfigFile = await this.prepareGitConfigFile(cloneUrl, token)
    const fallbackImage =
      this.configService.get<string>('DEVPOD_FALLBACK_IMAGE')?.trim() || DEFAULT_DEVPOD_FALLBACK_IMAGE
    const source = this.buildWorkspaceSource(cloneUrl, repository.repoBaseBranch)
    const env = this.buildDevpodEnv(dockerConfigDirectory.path, gitConfigFile.path)
    const workspaceEnvArgs = this.buildWorkspaceEnvArgs(repository.envConfig)

    try {
      this.logger.log(`Creating DevPod workspace ${workspaceName} for issue ${issueId}`)
      await this.executeCommand(
        'devpod',
        [
          'up',
          workspaceName,
          '--id',
          workspaceName,
          '--source',
          source,
          '--ide',
          'openvscode',
          '--open-ide=false',
          '--configure-ssh=false',
          '--fallback-image',
          fallbackImage,
          ...workspaceEnvArgs,
        ],
        {
          env,
          maxBuffer: 10 * 1024 * 1024,
        },
      )

      this.logger.log(`Injecting Codex toolchain into workspace ${workspaceName}`)
      await this.initializeWorkspaceCodex(workspaceName, env, cloneUrl, token, codexAuthConfig, repository.mcpConfig)
      this.logger.log(`Collecting DevPod metadata for workspace ${workspaceName}`)
      await this.collectAndPersistWorkspaceMetadata(issueId, workspaceName, env)

      this.logger.log(
        `Created DevPod workspace ${workspaceName} for issue ${issueId} using project ${repository.projectId} (${repository.repoBaseBranch})`,
      )
      return workspaceName
    } catch (error) {
      const sensitiveValues: string[] = [token, ...getCodexAuthSensitiveValues(codexAuthConfig)].filter(
        (value): value is string => typeof value === 'string',
      )
      const message = this.redactSensitiveData(error instanceof Error ? error.message : String(error), sensitiveValues)
      const stderr = this.redactSensitiveData(this.extractStderr(error), sensitiveValues)

      this.logger.error(`Failed to create DevPod workspace for issue ${issueId}: ${message}`)
      if (stderr) {
        this.logger.error(`DevPod stderr for issue ${issueId}: ${stderr}`)
      }

      return null
    } finally {
      await this.cleanupGitConfigFile(gitConfigFile)
      await this.cleanupDockerConfigDirectory(dockerConfigDirectory)
    }
  }

  async runWorkspaceCommand(
    workspaceName: string,
    command: string,
    options: WorkspaceCommandOptions = {},
  ): Promise<DevpodCommandResult> {
    const dockerConfigDirectory = await this.prepareDockerConfigDirectory()

    try {
      const env = this.buildDevpodEnv(dockerConfigDirectory.path)
      Object.entries(options.forwardEnv ?? {}).forEach(([key, value]) => {
        env[key] = value
      })
      if (options.label) {
        this.logger.log(`Running workspace command for ${workspaceName}: ${options.label}`)
      }
      return await this.executeWorkspaceCommand(workspaceName, env, command, options)
    } finally {
      await this.cleanupDockerConfigDirectory(dockerConfigDirectory)
    }
  }

  async deleteWorkspace(workspaceName: string): Promise<void> {
    const dockerConfigDirectory = await this.prepareDockerConfigDirectory()

    try {
      const env = this.buildDevpodEnv(dockerConfigDirectory.path)

      this.logger.log(`Deleting DevPod workspace ${workspaceName}`)
      await this.executeCommand('devpod', ['delete', workspaceName, '--force', '--ignore-not-found'], {
        env,
        maxBuffer: 10 * 1024 * 1024,
      })
      this.logger.log(`Deleted DevPod workspace ${workspaceName}`)
    } finally {
      await this.cleanupDockerConfigDirectory(dockerConfigDirectory)
    }
  }

  private async getIssueProjectRepository(
    issueId: number,
    workspaceId: string,
  ): Promise<IssueProjectRepository | null> {
    const projectBinding = await this.prisma.client.property_single_value.findFirst({
      where: {
        issue_id: issueId,
        property_id: SystemPropertyId.PROJECT,
        deleted_at: null,
        value: { not: null },
      },
      select: {
        value: true,
      },
    })

    const projectId = projectBinding?.value?.trim()
    if (!projectId) {
      return null
    }

    const project = await this.prisma.client.project.findFirst({
      where: {
        id: projectId,
        workspace_id: workspaceId,
        deleted_at: null,
      },
      select: {
        env_config: true,
        github_repo_url: true,
        mcp_config: true,
        repo_base_branch: true,
      },
    })

    if (!project) {
      return null
    }

    return {
      projectId,
      envConfig: parseProjectEnvConfig(project.env_config),
      githubRepoUrl: project.github_repo_url,
      mcpConfig: parseProjectMcpConfig(project.mcp_config),
      repoBaseBranch: project.repo_base_branch,
    }
  }

  private buildWorkspaceName(issueId: number): string {
    return `harness-kanban-issue-${issueId}`
  }

  private async initializeWorkspaceCodex(
    workspaceName: string,
    env: NodeJS.ProcessEnv,
    githubRepoUrl: string,
    githubToken: string,
    codexAuthConfig: ResolvedCodexAuthConfig,
    mcpConfig: ProjectMcpConfig | null,
  ): Promise<void> {
    const platform = await this.detectWorkspacePlatform(workspaceName, env)
    const artifact = await this.toolchainService.resolveCodexToolchainArtifact(platform)

    await this.injectWorkspaceCodexToolchain(workspaceName, env, artifact.archivePath, artifact.version)

    if (codexAuthConfig.authMode === 'auth-json') {
      const codexAuthJsonBase64 = Buffer.from(codexAuthConfig.authJson, 'utf8').toString('base64')
      await this.executeWorkspaceCommand(
        workspaceName,
        env,
        `mkdir -p ~/.codex && printf %s ${this.quoteShellArg(codexAuthJsonBase64)} | base64 -d > ~/.codex/auth.json`,
        {
          label: 'seed Codex auth.json',
          maxBuffer: 10 * 1024 * 1024,
        },
      )
    }

    await this.configureWorkspaceCodexMcp(workspaceName, env, mcpConfig)
    await this.configureWorkspaceGitIdentity(workspaceName, env)
    await this.configureWorkspaceGitAuth(workspaceName, env, githubRepoUrl, githubToken)
  }

  // TODO codex specific logic needs to be encapsulated after a common agent-executor interface is set
  private async configureWorkspaceCodexMcp(
    workspaceName: string,
    env: NodeJS.ProcessEnv,
    mcpConfig: ProjectMcpConfig | null,
  ): Promise<void> {
    if (!mcpConfig || Object.keys(mcpConfig).length === 0) {
      return
    }

    const commands = Object.entries(mcpConfig).flatMap(([name, serverConfig]) => [
      `"$HOME/.harness-kanban/bin/codex" mcp remove ${this.quoteShellArg(name)} >/dev/null 2>&1 || true`,
      this.buildCodexMcpAddCommand(name, serverConfig),
    ])

    await this.executeWorkspaceCommand(workspaceName, env, ['set -eu', ...commands].join('\n'), {
      label: 'configure Codex MCP servers',
      maxBuffer: 10 * 1024 * 1024,
    })
  }

  private buildCodexMcpAddCommand(name: string, serverConfig: ProjectMcpServerConfig): string {
    if (serverConfig.type === 'streamable-http') {
      return `"$HOME/.harness-kanban/bin/codex" mcp add ${this.quoteShellArg(name)} --url ${this.quoteShellArg(serverConfig.url)}`
    }

    const envArgs = Object.entries(serverConfig.env ?? {}).flatMap(([key, value]) => ['--env', `${key}=${value}`])
    const quotedEnvArgs = envArgs.map(value => this.quoteShellArg(value)).join(' ')
    const quotedCommandArgs = [serverConfig.command, ...(serverConfig.args ?? [])]
      .map(value => this.quoteShellArg(value))
      .join(' ')

    return [
      `"$HOME/.harness-kanban/bin/codex" mcp add ${this.quoteShellArg(name)}`,
      quotedEnvArgs,
      '--',
      quotedCommandArgs,
    ]
      .filter(Boolean)
      .join(' ')
  }

  private async detectWorkspacePlatform(
    workspaceName: string,
    env: NodeJS.ProcessEnv,
  ): Promise<HarnessWorkerToolchainPlatform> {
    const result = await this.executeWorkspaceCommand(workspaceName, env, 'uname -s && uname -m', {
      label: 'detect workspace platform',
      maxBuffer: 1024 * 1024,
    })

    const values = result.stdout
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(value => value.length > 0)

    const osValue = values[0]
    const archValue = values[1]

    if (osValue !== 'Linux') {
      throw new Error(`Unsupported workspace operating system: ${osValue ?? 'unknown'}`)
    }

    switch (archValue) {
      case 'aarch64':
      case 'arm64':
        return { os: 'linux', arch: 'arm64' }
      case 'amd64':
      case 'x86_64':
        return { os: 'linux', arch: 'x64' }
      default:
        throw new Error(`Unsupported workspace architecture: ${archValue ?? 'unknown'}`)
    }
  }

  private async injectWorkspaceCodexToolchain(
    workspaceName: string,
    env: NodeJS.ProcessEnv,
    archivePath: string,
    version: string,
  ): Promise<void> {
    const command = [
      'set -eu',
      'mkdir -p "$HOME/.harness-kanban/toolchains/codex" "$HOME/.harness-kanban/bin"',
      `version_name=${this.quoteShellArg(version)}`,
      'target_dir="$HOME/.harness-kanban/toolchains/codex/$version_name"',
      'rm -rf "$target_dir"',
      'mkdir -p "$target_dir"',
      'tar -xzf - -C "$target_dir"',
      'ln -sfn "$target_dir" "$HOME/.harness-kanban/toolchains/codex/current"',
      'if [ -d "$target_dir/bin" ]; then',
      '  for bin_path in "$target_dir"/bin/*; do',
      '    if [ -f "$bin_path" ]; then',
      '      chmod +x "$bin_path"',
      '      bin_name="$(basename "$bin_path")"',
      '      launcher_path="$HOME/.harness-kanban/bin/$bin_name"',
      '      cat > "$launcher_path" <<EOF',
      '#!/bin/sh',
      'set -eu',
      'exec "\\$HOME/.harness-kanban/toolchains/codex/current/bin/$bin_name" "\\$@"',
      'EOF',
      '      chmod +x "$launcher_path"',
      '    fi',
      '  done',
      'fi',
      'path_helper_path="$HOME/.harness-kanban/path.sh"',
      `cat > "$path_helper_path" <<'EOF'`,
      'case ":$PATH:" in',
      '  *:"$HOME/.harness-kanban/bin":*) ;;',
      '  *) export PATH="$HOME/.harness-kanban/bin:$PATH" ;;',
      'esac',
      'EOF',
      `profile_line='. "$HOME/.harness-kanban/path.sh"'`,
      'for rc_path in "$HOME/.profile" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.zprofile" "$HOME/.zshrc"; do',
      '  touch "$rc_path"',
      '  if ! grep -Fqx "$profile_line" "$rc_path" 2>/dev/null; then',
      '    printf "\\n%s\\n" "$profile_line" >> "$rc_path"',
      '  fi',
      'done',
      'global_bin_dir=""',
      'for candidate in /usr/local/bin /usr/bin; do',
      '  if [ -d "$candidate" ] && [ -w "$candidate" ]; then',
      '    global_bin_dir="$candidate"',
      '    break',
      '  fi',
      'done',
      'if [ -z "$global_bin_dir" ]; then',
      '  old_ifs="$IFS"',
      '  IFS=:',
      '  for candidate in $PATH; do',
      '    if [ -n "$candidate" ] && [ -d "$candidate" ] && [ -w "$candidate" ]; then',
      '      global_bin_dir="$candidate"',
      '      break',
      '    fi',
      '  done',
      '  IFS="$old_ifs"',
      'fi',
      'if [ -n "$global_bin_dir" ]; then',
      '  ln -sfn "$HOME/.harness-kanban/bin/codex" "$global_bin_dir/codex"',
      'fi',
    ].join('\n')

    await this.executeCommandWithInput('devpod', this.buildWorkspaceSshArgs(workspaceName, command), archivePath, {
      env,
      maxBuffer: 10 * 1024 * 1024,
    })
  }

  private async collectAndPersistWorkspaceMetadata(
    issueId: number,
    workspaceName: string,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    try {
      const metadata = await this.collectWorkspaceMetadata(workspaceName, env)
      if (!metadata) {
        this.logger.warn(`DevPod metadata was not found for workspace ${workspaceName}`)
        return
      }

      const updateResult = await this.prisma.client.harness_worker.updateMany({
        where: {
          issue_id: issueId,
        },
        data: {
          devpod_metadata: metadata as unknown as Prisma.InputJsonValue,
        },
      })

      if (updateResult.count !== 1) {
        this.logger.warn(
          `Failed to persist DevPod metadata for issue ${issueId}: expected 1 worker row, got ${updateResult.count}`,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Failed to collect DevPod metadata for workspace ${workspaceName}: ${message}`)
    }
  }

  private buildWorkspaceSource(githubRepoUrl: string, repoBaseBranch: string): string {
    return `git:${githubRepoUrl}@${repoBaseBranch}`
  }

  private buildWorkspaceEnvArgs(envConfig: ProjectEnvConfig | null): string[] {
    if (!envConfig) {
      return []
    }

    // TODO: Replace plain-text project env propagation with secure secret handling before production use.
    // TODO: DevPod `--workspace-env` currently makes these variables visible to `devpod ssh` commands and the child
    // processes they spawn, but not to arbitrary container processes such as `docker exec` sessions or long-running
    // services. Revisit this when DevPod offers a container-wide env injection path that does not require mutating a
    // user project's devcontainer configuration.
    return Object.entries(envConfig).flatMap(([key, value]) => ['--workspace-env', `${key}=${value}`])
  }

  private normalizeCloneUrl(githubRepoUrl: string): string {
    return normalizeGithubRepoUrl(githubRepoUrl) ?? githubRepoUrl.trim()
  }

  private buildDevpodEnv(dockerConfigDirectory: string, gitConfigPath?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      DOCKER_CONFIG: dockerConfigDirectory,
      GIT_TERMINAL_PROMPT: '0',
    }

    if (gitConfigPath) {
      env.GIT_CONFIG_GLOBAL = gitConfigPath
    }

    PASSTHROUGH_ENV_KEYS.forEach(key => {
      const value = process.env[key]
      if (value) {
        env[key] = value
      }
    })

    if (!env.PATH && process.env.PATH) {
      env.PATH = process.env.PATH
    }

    if (!env.HOME && process.env.HOME) {
      env.HOME = process.env.HOME
    }

    if (!env.DEVPOD_HOME && env.HOME) {
      env.DEVPOD_HOME = join(env.HOME, '.devpod')
    }

    if (!env.LANG) {
      env.LANG = 'C.UTF-8'
    }

    if (!env.LC_ALL) {
      env.LC_ALL = 'C.UTF-8'
    }

    return env
  }

  private async collectWorkspaceMetadata(
    workspaceName: string,
    env: NodeJS.ProcessEnv,
  ): Promise<HarnessWorkerDevpodMetadata | null> {
    const workspace = await this.readWorkspaceRecord(workspaceName, env)
    if (!workspace) {
      return null
    }

    const statusResult = await Promise.allSettled([
      this.readWorkspaceStatus(workspaceName, env),
      this.readWorkspaceResult(this.toNullableString(workspace.context) ?? 'default', workspaceName, env),
    ])

    const status = statusResult[0].status === 'fulfilled' ? statusResult[0].value : null
    const result = statusResult[1].status === 'fulfilled' ? statusResult[1].value : null

    return {
      workspace: {
        id: this.toNullableString(workspace.id),
        uid: this.toNullableString(workspace.uid),
        provider: {
          name: this.toNullableString(workspace.provider?.name),
        },
        ide: {
          name: this.toNullableString(workspace.ide?.name),
        },
        source: this.sanitizeWorkspaceSource(workspace.source),
        creationTimestamp: this.toNullableString(workspace.creationTimestamp),
      },
      status: {
        state: this.toNullableString(status?.state),
      },
      result: {
        devContainer: {
          path: this.toNullableString(result?.DevContainerConfigWithPath?.path),
        },
        merged: {
          image: this.toNullableString(result?.MergedConfig?.image),
          remoteUser: this.toNullableString(result?.MergedConfig?.remoteUser),
        },
        substitution: {
          devContainerId: this.toNullableString(result?.SubstitutionContext?.DevContainerID),
          containerWorkspaceFolder: this.toNullableString(result?.SubstitutionContext?.ContainerWorkspaceFolder),
        },
        container: {
          id: this.toNullableString(result?.ContainerDetails?.ID),
          created: this.toNullableString(result?.ContainerDetails?.Created),
          state: {
            status: this.toNullableString(result?.ContainerDetails?.State?.Status),
            startedAt: this.toNullableString(result?.ContainerDetails?.State?.StartedAt),
          },
        },
      },
    }
  }

  private async readWorkspaceRecord(
    workspaceName: string,
    env: NodeJS.ProcessEnv,
  ): Promise<DevpodWorkspaceRecord | null> {
    const result = await this.executeCommand('devpod', ['list', '--output', 'json'], {
      env,
      maxBuffer: 10 * 1024 * 1024,
    })

    const workspaces = this.parseJson<DevpodWorkspaceRecord[]>(result.stdout, 'DevPod workspace list')
    return workspaces.find(workspace => workspace.id === workspaceName) ?? null
  }

  private async readWorkspaceStatus(
    workspaceName: string,
    env: NodeJS.ProcessEnv,
  ): Promise<DevpodWorkspaceStatus | null> {
    const result = await this.executeCommand('devpod', ['status', workspaceName, '--output', 'json'], {
      env,
      maxBuffer: 10 * 1024 * 1024,
    })

    return this.parseJson<DevpodWorkspaceStatus>(result.stdout, `DevPod workspace status (${workspaceName})`)
  }

  private async readWorkspaceResult(
    context: string,
    workspaceName: string,
    env: NodeJS.ProcessEnv,
  ): Promise<DevpodWorkspaceResult | null> {
    const filePath = join(
      this.resolveDevpodHome(env),
      'contexts',
      context,
      'workspaces',
      workspaceName,
      'workspace_result.json',
    )
    const content = await readFile(filePath, 'utf8')
    return this.parseJson<DevpodWorkspaceResult>(content, `DevPod workspace result (${workspaceName})`)
  }

  private resolveDevpodHome(env: NodeJS.ProcessEnv): string {
    const devpodHome = env.DEVPOD_HOME ?? process.env.DEVPOD_HOME
    if (devpodHome) {
      return devpodHome
    }

    const home = env.HOME ?? process.env.HOME
    if (!home) {
      throw new Error('Cannot resolve DEVPOD_HOME because HOME is not set')
    }

    return join(home, '.devpod')
  }

  private sanitizeWorkspaceSource(source: DevpodWorkspaceSource | undefined): DevpodWorkspaceSource | null {
    if (!source) {
      return null
    }

    const sanitizedSource = Object.entries(source).reduce<DevpodWorkspaceSource>((accumulator, [key, value]) => {
      const normalized = this.toNullableString(value)
      if (normalized) {
        accumulator[key as keyof DevpodWorkspaceSource] = normalized
      }

      return accumulator
    }, {})

    return Object.keys(sanitizedSource).length > 0 ? sanitizedSource : null
  }

  private toNullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null
  }

  private parseJson<T>(value: string, label: string): T {
    try {
      return JSON.parse(value) as T
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to parse ${label}: ${message}`)
    }
  }

  private async prepareDockerConfigDirectory(): Promise<PreparedDockerConfigDirectory> {
    const configuredPath = this.configService.get<string>('DEVPOD_DOCKER_CONFIG_DIR')?.trim()
    if (configuredPath) {
      return {
        path: configuredPath,
        temporary: false,
      }
    }

    const directory = await mkdtemp(join(tmpdir(), 'harness-kanban-devpod-docker-config-'))
    await writeFile(join(directory, 'config.json'), '{}\n', 'utf8')

    return {
      path: directory,
      temporary: true,
    }
  }

  private async cleanupDockerConfigDirectory(directory: PreparedDockerConfigDirectory): Promise<void> {
    if (!directory.temporary) {
      return
    }

    await rm(directory.path, { recursive: true, force: true })
  }

  private async prepareGitConfigFile(githubRepoUrl: string, token: string): Promise<PreparedGitConfigFile> {
    const configuredPath = this.configService.get<string>('DEVPOD_GIT_CONFIG_PATH')?.trim()
    if (configuredPath) {
      return {
        path: configuredPath,
        directory: '',
        temporary: false,
      }
    }

    const directory = await mkdtemp(join(tmpdir(), 'harness-kanban-devpod-git-config-'))
    const path = join(directory, 'gitconfig')
    const credentialsPath = join(directory, 'credentials')
    const githubUsername = DEFAULT_GIT_CREDENTIAL_USERNAME

    await writeFile(credentialsPath, this.buildGitCredentialsContent(githubRepoUrl, githubUsername, token), 'utf8')
    await writeFile(path, this.buildGitConfigContent(githubRepoUrl, githubUsername, credentialsPath), 'utf8')

    return {
      path,
      directory,
      temporary: true,
    }
  }

  private async cleanupGitConfigFile(file: PreparedGitConfigFile): Promise<void> {
    if (!file.temporary) {
      return
    }

    await rm(file.directory, { recursive: true, force: true })
  }

  private buildGitConfigContent(githubRepoUrl: string, githubUsername: string, credentialsPath: string): string {
    const parsed = new URL(githubRepoUrl)
    const sourceOrigin = `${parsed.protocol}//${parsed.host}/`

    return [
      '[credential]',
      `\thelper = store --file=${credentialsPath}`,
      '',
      `[credential "${sourceOrigin}"]`,
      `\tusername = ${githubUsername}`,
      '',
    ].join('\n')
  }

  private buildGitCredentialsContent(githubRepoUrl: string, githubUsername: string, token: string): string {
    const parsed = new URL(githubRepoUrl)
    const authenticatedOrigin = new URL(`${parsed.protocol}//${parsed.host}`)

    authenticatedOrigin.username = githubUsername
    authenticatedOrigin.password = token

    return `${authenticatedOrigin.toString().replace(/\/$/, '')}\n`
  }

  private async configureWorkspaceGitIdentity(workspaceName: string, env: NodeJS.ProcessEnv): Promise<void> {
    const gitCommitName =
      this.configService.get<string>('HARNESS_WORKER_GIT_COMMIT_NAME')?.trim() || DEFAULT_GIT_COMMIT_NAME
    const gitCommitEmail =
      this.configService.get<string>('HARNESS_WORKER_GIT_COMMIT_EMAIL')?.trim() || DEFAULT_GIT_COMMIT_EMAIL

    await this.executeWorkspaceCommand(
      workspaceName,
      env,
      `git config --global user.name ${this.quoteShellArg(gitCommitName)} && git config --global user.email ${this.quoteShellArg(gitCommitEmail)}`,
      {
        label: 'configure git identity',
        maxBuffer: 10 * 1024 * 1024,
      },
    )
  }

  private async configureWorkspaceGitAuth(
    workspaceName: string,
    env: NodeJS.ProcessEnv,
    githubRepoUrl: string,
    token: string,
  ): Promise<void> {
    const parsed = new URL(githubRepoUrl)
    const sourceOrigin = `${parsed.protocol}//${parsed.host}/`
    const sshOrigin = `ssh://git@${parsed.host}/`
    const githubUsername = DEFAULT_GIT_CREDENTIAL_USERNAME
    const authenticatedOrigin = new URL(sourceOrigin)

    authenticatedOrigin.username = githubUsername
    authenticatedOrigin.password = token

    const authenticatedOriginValue = authenticatedOrigin.toString()

    await this.executeWorkspaceCommand(
      workspaceName,
      env,
      [
        `git config --global url.${this.quoteShellArg(authenticatedOriginValue)}.insteadOf ${this.quoteShellArg(sourceOrigin)}`,
        `git config --global --add url.${this.quoteShellArg(authenticatedOriginValue)}.insteadOf ${this.quoteShellArg(`git@${parsed.host}:`)}`,
        `git config --global --add url.${this.quoteShellArg(authenticatedOriginValue)}.insteadOf ${this.quoteShellArg(sshOrigin)}`,
      ].join(' && '),
      {
        label: 'configure git auth',
        maxBuffer: 10 * 1024 * 1024,
      },
    )
  }

  private async executeWorkspaceCommand(
    workspaceName: string,
    env: NodeJS.ProcessEnv,
    command: string,
    options: WorkspaceCommandOptions = {},
  ): Promise<DevpodCommandResult> {
    const args = this.buildWorkspaceSshArgs(workspaceName, command, options)

    return this.executeCommand('devpod', args, {
      env,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
      timeout: options.timeoutMs,
    })
  }

  private buildWorkspaceSshArgs(
    workspaceName: string,
    command: string,
    options: WorkspaceCommandOptions = {},
  ): string[] {
    const args = ['ssh', workspaceName]

    Object.keys(options.forwardEnv ?? {}).forEach(key => {
      args.push('--send-env', key)
    })

    args.push('--command', `sh -lc ${this.quoteShellArg(this.buildWorkspaceShellCommand(command))}`)

    return args
  }

  private buildWorkspaceShellCommand(command: string): string {
    return [
      'if [ -f "$HOME/.harness-kanban/path.sh" ]; then',
      '  . "$HOME/.harness-kanban/path.sh"',
      'else',
      '  PATH="$HOME/.harness-kanban/bin:$PATH"',
      '  export PATH',
      'fi',
      command,
    ].join('\n')
  }

  private quoteShellArg(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`
  }

  private async executeCommand(file: string, args: string[], options: ExecFileOptions): Promise<DevpodCommandResult> {
    return new Promise((resolve, reject) => {
      execFile(file, args, options, (error, stdout, stderr) => {
        if (error) {
          ;(error as Error & { stdout?: string; stderr?: string }).stdout = stdout
          ;(error as Error & { stdout?: string; stderr?: string }).stderr = stderr
          reject(error)
          return
        }

        resolve({
          stdout,
          stderr,
        })
      })
    })
  }

  private async executeCommandWithInput(
    file: string,
    args: string[],
    inputFilePath: string,
    options: ExecFileOptions,
  ): Promise<DevpodCommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024
      let stdoutLength = 0
      let stderrLength = 0
      let finished = false
      let timeoutId: NodeJS.Timeout | undefined

      const finalizeReject = (error: Error) => {
        if (finished) {
          return
        }

        finished = true
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        reject(error)
      }

      const finalizeResolve = (stdout: string, stderr: string) => {
        if (finished) {
          return
        }

        finished = true
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        resolve({ stdout, stderr })
      }

      const appendChunk = (target: Buffer[], kind: 'stderr' | 'stdout', chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const nextLength = kind === 'stdout' ? stdoutLength + buffer.length : stderrLength + buffer.length

        if (nextLength > maxBuffer) {
          child.kill('SIGTERM')
          finalizeReject(new Error(`Command output exceeded maxBuffer while collecting ${kind}`))
          return
        }

        if (kind === 'stdout') {
          stdoutLength = nextLength
        } else {
          stderrLength = nextLength
        }

        target.push(buffer)
      }

      child.on('error', error => {
        finalizeReject(error)
      })

      child.stdout.on('data', chunk => {
        appendChunk(stdoutChunks, 'stdout', chunk)
      })

      child.stderr.on('data', chunk => {
        appendChunk(stderrChunks, 'stderr', chunk)
      })

      const inputStream = createReadStream(inputFilePath)
      inputStream.on('error', error => {
        child.kill('SIGTERM')
        finalizeReject(error)
      })
      inputStream.pipe(child.stdin)

      if (typeof options.timeout === 'number' && options.timeout > 0) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM')
          finalizeReject(new Error(`Command timed out after ${options.timeout}ms`))
        }, options.timeout)
      }

      child.on('close', (code, signal) => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8')
        const stderr = Buffer.concat(stderrChunks).toString('utf8')

        if (finished) {
          return
        }

        if (code === 0) {
          finalizeResolve(stdout, stderr)
          return
        }

        const error = new Error(
          `Command ${file} ${args.join(' ')} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? 1}`}`,
        ) as Error & {
          stderr?: string
          stdout?: string
        }
        error.stdout = stdout
        error.stderr = stderr
        finalizeReject(error)
      })
    })
  }

  private extractStderr(error: unknown): string {
    if (!error || typeof error !== 'object' || !('stderr' in error)) {
      return ''
    }

    const stderr = (error as { stderr?: unknown }).stderr
    if (typeof stderr === 'string') {
      return stderr.trim()
    }

    return Buffer.isBuffer(stderr) ? stderr.toString('utf8').trim() : ''
  }

  private redactSensitiveData(text: string, sensitiveValues: string[]): string {
    if (!text) {
      return text
    }

    return sensitiveValues
      .map(value => value.trim())
      .filter(value => value.length > 0)
      .reduce((result, value) => result.split(value).join('***'), text)
  }
}
