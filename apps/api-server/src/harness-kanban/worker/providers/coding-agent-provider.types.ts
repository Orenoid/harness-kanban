import { CodingAgentSettings, CodingAgentType } from '@repo/shared'
import { ProjectMcpConfig } from '@repo/shared/project/types'
import { HarnessWorkerToolchainArtifact, HarnessWorkerToolchainPlatform } from '../toolchain.service'

export type DevpodCommandResult = {
  stderr: string
  stdout: string
}

export type WorkspaceCommandOptions = {
  forwardEnv?: Record<string, string>
  label?: string
  maxBuffer?: number
  timeoutMs?: number
}

export type HarnessWorkerCodingAgentRunResult = {
  finalMessage: string
  sessionId: string
}

export type HarnessWorkerCodingAgentWorkspacePreparationContext<TType extends CodingAgentType = CodingAgentType> = {
  mcpConfig: ProjectMcpConfig | null
  platform: HarnessWorkerToolchainPlatform
  remoteUser: string | null
  settings: CodingAgentSettings<TType>
  workspaceName: string
  executeWorkspaceCommand: (command: string, options?: WorkspaceCommandOptions) => Promise<DevpodCommandResult>
  injectToolchainArtifact: (artifact: HarnessWorkerToolchainArtifact) => Promise<void>
  quoteShellArg: (value: string) => string
}

export type HarnessWorkerCodingAgentRunContext<TType extends CodingAgentType = CodingAgentType> = {
  outputJsonSchema: unknown
  prompt: string
  remoteUser: string | null
  repoRoot: string
  resumeSessionId?: string
  settings: CodingAgentSettings<TType>
  timeoutMs: number
  workflowLabel: string
  workspaceName: string
  quoteShellArg: (value: string) => string
  runWorkspaceCommand: (command: string, options?: WorkspaceCommandOptions) => Promise<DevpodCommandResult>
}

export interface HarnessWorkerCodingAgentProvider<TType extends CodingAgentType = CodingAgentType> {
  type: TType
  getSensitiveValues(settings: CodingAgentSettings<TType>): string[]
  prepareWorkspace(context: HarnessWorkerCodingAgentWorkspacePreparationContext<TType>): Promise<void>
  runWithSchema(context: HarnessWorkerCodingAgentRunContext<TType>): Promise<HarnessWorkerCodingAgentRunResult>
}
