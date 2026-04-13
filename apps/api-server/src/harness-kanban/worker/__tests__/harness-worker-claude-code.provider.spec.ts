import { HarnessWorkerClaudeCodeProvider } from '../providers/harness-worker-claude-code.provider'
import { HarnessWorkerToolchainService } from '../toolchain.service'

describe('HarnessWorkerClaudeCodeProvider', () => {
  it('seeds Claude Code settings with empty attribution', async () => {
    const toolchainService = {
      resolveToolchainArtifact: jest.fn().mockResolvedValue({
        archivePath: '/opt/harness-kanban/toolchains/claude-code/2.1.92/claude-code-toolchain-linux-x64.tar.gz',
        kind: 'claude-code',
        version: '2.1.92',
      }),
    } as unknown as HarnessWorkerToolchainService
    const provider = new HarnessWorkerClaudeCodeProvider(toolchainService)
    const executeWorkspaceCommand = jest.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const injectToolchainArtifact = jest.fn().mockResolvedValue(undefined)

    await provider.prepareWorkspace({
      executeWorkspaceCommand,
      injectToolchainArtifact,
      mcpConfig: null,
      platform: {
        arch: 'x64',
        os: 'linux',
      },
      quoteShellArg: value => `'${value.replaceAll("'", "'\"'\"'")}'`,
      remoteUser: null,
      settings: {
        apiKey: 'sk-test',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
      },
      workspaceName: 'test-workspace',
    })

    const seedSettingsCommand = executeWorkspaceCommand.mock.calls.find(([, options]) => {
      return options?.label === 'seed Claude Code settings'
    })?.[0]
    const settingsBase64 = seedSettingsCommand?.match(/Buffer\.from\("([^"]+)"/)?.[1]
    const settingsPatch =
      typeof settingsBase64 === 'string' ? JSON.parse(Buffer.from(settingsBase64, 'base64').toString('utf8')) : null

    expect(seedSettingsCommand).toContain("path.join(settingsDir, 'settings.json')")
    expect(settingsPatch).toEqual({
      attribution: {
        commit: '',
        pr: '',
      },
    })
  })

  it('sets a longer MCP startup timeout when using a Claude MCP config', () => {
    const provider = new HarnessWorkerClaudeCodeProvider({} as HarnessWorkerToolchainService)
    const command = (
      provider as unknown as {
        buildClaudeCommandScript: (
          context: {
            quoteShellArg: (value: string) => string
            repoRoot: string
            remoteUser?: string | null
            settings: {
              apiKey: string
              baseUrl: string
              model: string
            }
          },
          input: {
            promptBase64: string
            repoRoot: string
            schemaBase64: string
          },
        ) => string
      }
    ).buildClaudeCommandScript(
      {
        quoteShellArg: value => `'${value.replaceAll("'", "'\"'\"'")}'`,
        repoRoot: '/workspaces/harness-kanban',
        remoteUser: 'node',
        settings: {
          apiKey: 'sk-test',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-5',
        },
      },
      {
        promptBase64: Buffer.from('test prompt', 'utf8').toString('base64'),
        repoRoot: '/workspaces/harness-kanban',
        schemaBase64: Buffer.from('{}', 'utf8').toString('base64'),
      },
    )

    expect(command).toContain('export MCP_TIMEOUT=')
    expect(command).toContain('30000')
    expect(command).toContain('--mcp-config')
    expect(command).toContain('--strict-mcp-config')
    expect(command).toContain('--dangerously-skip-permissions')
    expect(command).toContain('< /dev/null > "$tmpdir/claude-output.json"')
  })

  it('does not add skip-permissions when running without a non-root remote user', () => {
    const provider = new HarnessWorkerClaudeCodeProvider({} as HarnessWorkerToolchainService)
    const command = (
      provider as unknown as {
        buildClaudeCommandScript: (
          context: {
            quoteShellArg: (value: string) => string
            repoRoot: string
            remoteUser?: string | null
            settings: {
              apiKey: string
              baseUrl: string
              model: string
            }
          },
          input: {
            promptBase64: string
            repoRoot: string
            schemaBase64: string
          },
        ) => string
      }
    ).buildClaudeCommandScript(
      {
        quoteShellArg: value => `'${value.replaceAll("'", "'\"'\"'")}'`,
        repoRoot: '/workspaces/harness-kanban',
        remoteUser: null,
        settings: {
          apiKey: 'sk-test',
          baseUrl: 'https://api.anthropic.com',
          model: 'claude-sonnet-4-5',
        },
      },
      {
        promptBase64: Buffer.from('test prompt', 'utf8').toString('base64'),
        repoRoot: '/workspaces/harness-kanban',
        schemaBase64: Buffer.from('{}', 'utf8').toString('base64'),
      },
    )

    expect(command).not.toContain('--dangerously-skip-permissions')
  })
})
