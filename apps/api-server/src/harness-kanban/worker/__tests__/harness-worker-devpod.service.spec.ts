import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PrismaService } from '@/database/prisma.service'
import { GithubService } from '@/github/github.service'
import { ConfigService } from '@nestjs/config'
import { HarnessWorkerDevpodService } from '../harness-worker-devpod.service'
import { HarnessWorkerToolchainService } from '../harness-worker-toolchain.service'

describe('HarnessWorkerDevpodService', () => {
  let service: HarnessWorkerDevpodService
  let configService: jest.Mocked<ConfigService>
  let githubService: jest.Mocked<GithubService>
  let toolchainService: jest.Mocked<HarnessWorkerToolchainService>
  let findProjectBindingMock: jest.Mock
  let findProjectMock: jest.Mock
  let updateWorkerMock: jest.Mock

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>
    githubService = {
      getTokenForWorkspace: jest.fn(),
    } as unknown as jest.Mocked<GithubService>
    toolchainService = {
      resolveCodexToolchainArtifact: jest.fn(),
    } as unknown as jest.Mocked<HarnessWorkerToolchainService>

    findProjectBindingMock = jest.fn()
    findProjectMock = jest.fn()
    updateWorkerMock = jest.fn().mockResolvedValue({ count: 1 })

    const prismaService = {
      client: {
        property_single_value: {
          findFirst: findProjectBindingMock,
        },
        project: {
          findFirst: findProjectMock,
        },
        harness_worker: {
          updateMany: updateWorkerMock,
        },
      },
    } as unknown as jest.Mocked<PrismaService>

    service = new HarnessWorkerDevpodService(prismaService, configService, toolchainService, githubService)
  })

  it('returns null when the issue is not bound to a project', async () => {
    findProjectBindingMock.mockResolvedValue(null)

    await expect(service.createWorkspaceForIssue(101, 'workspace-1')).resolves.toBeNull()
    expect(findProjectMock).not.toHaveBeenCalled()
  })

  it('returns null when the workspace GitHub token is missing', async () => {
    findProjectBindingMock.mockResolvedValue({ value: 'project-1' })
    findProjectMock.mockResolvedValue({
      env_config: null,
      github_repo_url: 'https://github.com/harness-kanban/payments-api',
      mcp_config: null,
      repo_base_branch: 'main',
    })
    githubService.getTokenForWorkspace.mockRejectedValue(new Error('GitHub token is not configured.'))

    await expect(service.createWorkspaceForIssue(101, 'workspace-1')).resolves.toBeNull()
  })

  it('returns null when CODEX_AUTH_JSON is missing', async () => {
    findProjectBindingMock.mockResolvedValue({ value: 'project-1' })
    findProjectMock.mockResolvedValue({
      env_config: null,
      github_repo_url: 'https://github.com/harness-kanban/payments-api',
      mcp_config: null,
      repo_base_branch: 'main',
    })
    githubService.getTokenForWorkspace.mockResolvedValue('github-token-value')

    await expect(service.createWorkspaceForIssue(101, 'workspace-1')).resolves.toBeNull()
  })

  it('writes credential helper config for DevPod git authentication', async () => {
    const prepared = await (
      service as unknown as {
        prepareGitConfigFile: (
          githubRepoUrl: string,
          token: string,
        ) => Promise<{
          path: string
          directory: string
          temporary: boolean
        }>
      }
    ).prepareGitConfigFile('https://github.com/harness-kanban/payments-api', 'github-token-value')

    const configContent = await readFile(prepared.path, 'utf8')
    const credentialsContent = await readFile(join(prepared.directory, 'credentials'), 'utf8')

    expect(configContent).toContain('[credential]')
    expect(configContent).toContain(`helper = store --file=${join(prepared.directory, 'credentials')}`)
    expect(configContent).toContain('[credential "https://github.com/"]')
    expect(configContent).toContain('username = x-access-token')
    expect(configContent).not.toContain('github-token-value')
    expect(credentialsContent).toContain('https://x-access-token:github-token-value@github.com')

    await (
      service as unknown as {
        cleanupGitConfigFile: (file: { path: string; directory: string; temporary: boolean }) => Promise<void>
      }
    ).cleanupGitConfigFile(prepared)
  })

  it('runs devpod up with a temporary git config for private repository access', async () => {
    const codexAuthJson = '{"provider":"openai","accessToken":"codex-token"}'
    const codexAuthJsonBase64 = Buffer.from(codexAuthJson, 'utf8').toString('base64')

    findProjectBindingMock.mockResolvedValue({ value: 'project-1' })
    findProjectMock.mockResolvedValue({
      env_config: {
        API_BASE_URL: 'https://api.example.com',
        DEBUG: 'true',
      },
      github_repo_url: 'git@github.com:harness-kanban/payments-api.git',
      mcp_config: {
        docs: {
          type: 'streamable-http',
          url: 'https://example.com/mcp',
        },
        'repo-tools': {
          type: 'stdio',
          command: 'node',
          args: ['scripts/mcp.js', '--port', '3000'],
          env: {
            DEBUG: '1',
          },
        },
      },
      repo_base_branch: 'feature/planning',
    })
    configService.get.mockImplementation((key: string) => {
      if (key === 'CODEX_AUTH_JSON') {
        return codexAuthJson
      }

      return undefined
    })
    githubService.getTokenForWorkspace.mockResolvedValue('github-token-value')
    toolchainService.resolveCodexToolchainArtifact.mockResolvedValue({
      archivePath: '/opt/harness-kanban/toolchains/codex/0.116.0/codex-toolchain-linux-x64.tar.gz',
      kind: 'codex',
      version: '0.116.0',
    })

    const executeCommandSpy = jest
      .spyOn(
        service as unknown as {
          executeCommand: (
            file: string,
            args: string[],
            options: unknown,
          ) => Promise<{ stdout: string; stderr: string }>
        },
        'executeCommand',
      )
      .mockImplementation(async (_file: string, args: string[]) => {
        if (args[0] === 'ssh' && args[1] === 'harness-kanban-issue-101' && args[3]?.includes('uname -s && uname -m')) {
          return {
            stdout: 'Linux\nx86_64\n',
            stderr: '',
          }
        }

        return { stdout: '', stderr: '' }
      })
    const executeCommandWithInputSpy = jest
      .spyOn(
        service as unknown as {
          executeCommandWithInput: (
            file: string,
            args: string[],
            inputFilePath: string,
            options: unknown,
          ) => Promise<{ stdout: string; stderr: string }>
        },
        'executeCommandWithInput',
      )
      .mockResolvedValue({ stdout: '', stderr: '' })
    const prepareDockerConfigDirectorySpy = jest
      .spyOn(
        service as unknown as {
          prepareDockerConfigDirectory: () => Promise<{ path: string; temporary: boolean }>
        },
        'prepareDockerConfigDirectory',
      )
      .mockResolvedValue({ path: '/tmp/harness-kanban-devpod-docker-config', temporary: false })
    const cleanupDockerConfigDirectorySpy = jest
      .spyOn(
        service as unknown as {
          cleanupDockerConfigDirectory: (directory: { path: string; temporary: boolean }) => Promise<void>
        },
        'cleanupDockerConfigDirectory',
      )
      .mockResolvedValue()
    const prepareGitConfigFileSpy = jest
      .spyOn(
        service as unknown as {
          prepareGitConfigFile: (
            githubRepoUrl: string,
            token: string,
          ) => Promise<{ path: string; directory: string; temporary: boolean }>
        },
        'prepareGitConfigFile',
      )
      .mockResolvedValue({
        path: '/tmp/harness-kanban-devpod-git-config/gitconfig',
        directory: '/tmp/harness-kanban-devpod-git-config',
        temporary: false,
      })
    const cleanupGitConfigFileSpy = jest
      .spyOn(
        service as unknown as {
          cleanupGitConfigFile: (file: { path: string; directory: string; temporary: boolean }) => Promise<void>
        },
        'cleanupGitConfigFile',
      )
      .mockResolvedValue()
    jest
      .spyOn(
        service as unknown as {
          readWorkspaceRecord: (
            workspaceName: string,
            env: NodeJS.ProcessEnv,
          ) => Promise<{
            id?: string
            uid?: string
            provider?: { name?: string }
            ide?: { name?: string }
            source?: Record<string, string>
            creationTimestamp?: string
            context?: string
          } | null>
        },
        'readWorkspaceRecord',
      )
      .mockResolvedValue({
        id: 'harness-kanban-issue-101',
        uid: 'default-ai-123',
        provider: { name: 'docker' },
        ide: { name: 'openvscode' },
        source: {
          gitRepository: 'https://github.com/harness-kanban/payments-api',
          gitBranch: 'feature/planning',
        },
        creationTimestamp: '2026-03-14T10:49:11Z',
        context: 'default',
      })
    jest
      .spyOn(
        service as unknown as {
          readWorkspaceStatus: (workspaceName: string, env: NodeJS.ProcessEnv) => Promise<{ state?: string } | null>
        },
        'readWorkspaceStatus',
      )
      .mockResolvedValue({
        state: 'Running',
      })
    jest
      .spyOn(
        service as unknown as {
          readWorkspaceResult: (
            context: string,
            workspaceName: string,
            env: NodeJS.ProcessEnv,
          ) => Promise<{
            DevContainerConfigWithPath?: { path?: string }
            MergedConfig?: { image?: string; remoteUser?: string }
            SubstitutionContext?: { DevContainerID?: string; ContainerWorkspaceFolder?: string }
            ContainerDetails?: {
              ID?: string
              Created?: string
              State?: { Status?: string; StartedAt?: string }
            }
          } | null>
        },
        'readWorkspaceResult',
      )
      .mockResolvedValue({
        DevContainerConfigWithPath: {
          path: '.devcontainer.json',
        },
        MergedConfig: {
          image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
          remoteUser: 'vscode',
        },
        SubstitutionContext: {
          DevContainerID: 'default-ai-123',
          ContainerWorkspaceFolder: '/workspaces/harness-kanban-issue-101',
        },
        ContainerDetails: {
          ID: 'container-123',
          Created: '2026-03-14T10:49:16.033274217Z',
          State: {
            Status: 'running',
            StartedAt: '2026-03-14T10:49:17.168735135Z',
          },
        },
      })

    await expect(service.createWorkspaceForIssue(101, 'workspace-1')).resolves.toBe('harness-kanban-issue-101')
    expect(prepareDockerConfigDirectorySpy).toHaveBeenCalled()
    expect(prepareGitConfigFileSpy).toHaveBeenCalledWith(
      'https://github.com/harness-kanban/payments-api',
      'github-token-value',
    )

    expect(executeCommandSpy).toHaveBeenNthCalledWith(
      1,
      'devpod',
      [
        'up',
        'harness-kanban-issue-101',
        '--id',
        'harness-kanban-issue-101',
        '--source',
        'git:https://github.com/harness-kanban/payments-api@feature/planning',
        '--ide',
        'openvscode',
        '--open-ide=false',
        '--configure-ssh=false',
        '--fallback-image',
        'mcr.microsoft.com/devcontainers/base:ubuntu',
        '--workspace-env',
        'API_BASE_URL=https://api.example.com',
        '--workspace-env',
        'DEBUG=true',
      ],
      expect.objectContaining({
        env: expect.objectContaining({
          DOCKER_CONFIG: '/tmp/harness-kanban-devpod-docker-config',
          GIT_CONFIG_GLOBAL: '/tmp/harness-kanban-devpod-git-config/gitconfig',
          GIT_TERMINAL_PROMPT: '0',
        }),
      }),
    )

    expect(executeCommandSpy).toHaveBeenNthCalledWith(
      2,
      'devpod',
      ['ssh', 'harness-kanban-issue-101', '--command', expect.stringContaining('uname -s && uname -m')],
      expect.objectContaining({
        env: expect.objectContaining({
          DOCKER_CONFIG: '/tmp/harness-kanban-devpod-docker-config',
          GIT_CONFIG_GLOBAL: '/tmp/harness-kanban-devpod-git-config/gitconfig',
          GIT_TERMINAL_PROMPT: '0',
        }),
      }),
    )

    expect(toolchainService.resolveCodexToolchainArtifact).toHaveBeenCalledWith({
      arch: 'x64',
      os: 'linux',
    })
    expect(executeCommandWithInputSpy).toHaveBeenCalledWith(
      'devpod',
      expect.arrayContaining([
        'ssh',
        'harness-kanban-issue-101',
        '--command',
        expect.stringContaining('tar -xzf - -C "$target_dir"'),
      ]),
      '/opt/harness-kanban/toolchains/codex/0.116.0/codex-toolchain-linux-x64.tar.gz',
      expect.objectContaining({
        env: expect.objectContaining({
          DOCKER_CONFIG: '/tmp/harness-kanban-devpod-docker-config',
          GIT_CONFIG_GLOBAL: '/tmp/harness-kanban-devpod-git-config/gitconfig',
          GIT_TERMINAL_PROMPT: '0',
        }),
      }),
    )
    const injectCommand = executeCommandWithInputSpy.mock.calls[0]?.[1]?.[3]
    expect(injectCommand).toContain('launcher_path="$HOME/.harness-kanban/bin/$bin_name"')
    expect(injectCommand).toContain('path_helper_path="$HOME/.harness-kanban/path.sh"')
    expect(injectCommand).toContain('cat > "$launcher_path" <<EOF')
    expect(injectCommand).toContain('case ":$PATH:" in')
    expect(injectCommand).toContain('. "$HOME/.harness-kanban/path.sh"')
    expect(injectCommand).toContain('ln -sfn "$HOME/.harness-kanban/bin/codex" "$global_bin_dir/codex"')
    expect(injectCommand).toContain('exec "\\$HOME/.harness-kanban/toolchains/codex/current/bin/$bin_name" "\\$@"')

    const authCommand = executeCommandSpy.mock.calls[2]?.[1]?.[3]
    expect(authCommand).toContain('mkdir -p ~/.codex')
    expect(authCommand).toContain(codexAuthJsonBase64)
    expect(authCommand).toContain('base64 -d > ~/.codex/auth.json')

    const mcpCommand = executeCommandSpy.mock.calls[3]?.[1]?.[3]
    expect(mcpCommand).toContain('"$HOME/.harness-kanban/bin/codex" mcp remove')
    expect(mcpCommand).toContain('"$HOME/.harness-kanban/bin/codex" mcp add')
    expect(mcpCommand).toContain('docs')
    expect(mcpCommand).toContain('repo-tools')
    expect(mcpCommand).toContain('https://example.com/mcp')
    expect(mcpCommand).toContain('DEBUG=1')
    expect(mcpCommand).toContain('scripts/mcp.js')
    expect(mcpCommand).toContain('--port')
    expect(mcpCommand).toContain('3000')

    const gitIdentityCommand = executeCommandSpy.mock.calls[4]?.[1]?.[3]
    expect(gitIdentityCommand).toContain('git config --global user.name')
    expect(gitIdentityCommand).toContain('Code Bot')
    expect(gitIdentityCommand).toContain('bot_code_bot@harness-kanban.local')

    const gitAuthCommand = executeCommandSpy.mock.calls[5]?.[1]?.[3]
    expect(gitAuthCommand).toContain('git config --global url.')
    expect(gitAuthCommand).toContain('https://x-access-token:github-token-value@github.com/')
    expect(gitAuthCommand).toContain('git@github.com:')
    expect(gitAuthCommand).toContain('ssh://git@github.com/')

    const executeOptions = executeCommandSpy.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv }
    expect(executeOptions.env.CODEX_AUTH_JSON).toBeUndefined()
    expect(updateWorkerMock).toHaveBeenCalledWith({
      where: {
        issue_id: 101,
      },
      data: {
        devpod_metadata: {
          workspace: {
            id: 'harness-kanban-issue-101',
            uid: 'default-ai-123',
            provider: {
              name: 'docker',
            },
            ide: {
              name: 'openvscode',
            },
            source: {
              gitRepository: 'https://github.com/harness-kanban/payments-api',
              gitBranch: 'feature/planning',
            },
            creationTimestamp: '2026-03-14T10:49:11Z',
          },
          status: {
            state: 'Running',
          },
          result: {
            devContainer: {
              path: '.devcontainer.json',
            },
            merged: {
              image: 'mcr.microsoft.com/devcontainers/base:ubuntu',
              remoteUser: 'vscode',
            },
            substitution: {
              devContainerId: 'default-ai-123',
              containerWorkspaceFolder: '/workspaces/harness-kanban-issue-101',
            },
            container: {
              id: 'container-123',
              created: '2026-03-14T10:49:16.033274217Z',
              state: {
                status: 'running',
                startedAt: '2026-03-14T10:49:17.168735135Z',
              },
            },
          },
        },
      },
    })
    expect(cleanupGitConfigFileSpy).toHaveBeenCalledWith({
      path: '/tmp/harness-kanban-devpod-git-config/gitconfig',
      directory: '/tmp/harness-kanban-devpod-git-config',
      temporary: false,
    })
    expect(cleanupDockerConfigDirectorySpy).toHaveBeenCalledWith({
      path: '/tmp/harness-kanban-devpod-docker-config',
      temporary: false,
    })
  })

  it('deletes a workspace with the devpod cli using the prepared environment', async () => {
    const executeCommandSpy = jest
      .spyOn(
        service as unknown as {
          executeCommand: (
            file: string,
            args: string[],
            options: unknown,
          ) => Promise<{ stdout: string; stderr: string }>
        },
        'executeCommand',
      )
      .mockResolvedValue({ stdout: '', stderr: '' })
    const prepareDockerConfigDirectorySpy = jest
      .spyOn(
        service as unknown as {
          prepareDockerConfigDirectory: () => Promise<{ path: string; temporary: boolean }>
        },
        'prepareDockerConfigDirectory',
      )
      .mockResolvedValue({ path: '/tmp/harness-kanban-devpod-docker-config', temporary: false })
    const cleanupDockerConfigDirectorySpy = jest
      .spyOn(
        service as unknown as {
          cleanupDockerConfigDirectory: (directory: { path: string; temporary: boolean }) => Promise<void>
        },
        'cleanupDockerConfigDirectory',
      )
      .mockResolvedValue()

    await service.deleteWorkspace('harness-kanban-issue-101')

    expect(prepareDockerConfigDirectorySpy).toHaveBeenCalledTimes(1)
    expect(executeCommandSpy).toHaveBeenCalledWith(
      'devpod',
      ['delete', 'harness-kanban-issue-101', '--force', '--ignore-not-found'],
      expect.objectContaining({
        env: expect.objectContaining({
          DOCKER_CONFIG: '/tmp/harness-kanban-devpod-docker-config',
          GIT_TERMINAL_PROMPT: '0',
        }),
      }),
    )
    expect(cleanupDockerConfigDirectorySpy).toHaveBeenCalledWith({
      path: '/tmp/harness-kanban-devpod-docker-config',
      temporary: false,
    })
  })
})
