import { HarnessWorkerClaudeCodeProvider } from '../providers/harness-worker-claude-code.provider'
import { HarnessWorkerToolchainService } from '../toolchain.service'

describe('HarnessWorkerClaudeCodeProvider', () => {
  it('sets a longer MCP startup timeout when using a Claude MCP config', () => {
    const provider = new HarnessWorkerClaudeCodeProvider({} as HarnessWorkerToolchainService)
    const command = (
      provider as unknown as {
        buildClaudeCommandScript: (
          context: {
            quoteShellArg: (value: string) => string
            repoRoot: string
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
  })
})
