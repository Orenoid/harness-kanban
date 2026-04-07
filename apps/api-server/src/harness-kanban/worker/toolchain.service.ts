import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { CodingAgentType } from '@repo/shared'

const DEFAULT_TOOLCHAIN_VERSION_BY_KIND: Record<CodingAgentType, string> = {
  codex: '0.116.0',
  'claude-code': '2.1.92',
}

const TOOLCHAIN_VERSION_ENV_BY_KIND: Record<CodingAgentType, string> = {
  codex: 'HARNESS_WORKER_CODEX_TOOLCHAIN_VERSION',
  'claude-code': 'HARNESS_WORKER_CLAUDE_CODE_TOOLCHAIN_VERSION',
}

export type HarnessWorkerToolchainPlatform = {
  arch: 'arm64' | 'x64'
  os: 'linux'
}

export type HarnessWorkerToolchainArtifact = {
  archivePath: string
  kind: CodingAgentType
  version: string
}

@Injectable()
export class HarnessWorkerToolchainService {
  constructor(private readonly configService: ConfigService) {}

  async resolveCodexToolchainArtifact(
    platform: HarnessWorkerToolchainPlatform,
  ): Promise<HarnessWorkerToolchainArtifact> {
    return this.resolveToolchainArtifact('codex', platform)
  }

  async resolveToolchainArtifact(
    kind: CodingAgentType,
    platform: HarnessWorkerToolchainPlatform,
  ): Promise<HarnessWorkerToolchainArtifact> {
    const version =
      this.configService.get<string>(TOOLCHAIN_VERSION_ENV_BY_KIND[kind])?.trim() ||
      DEFAULT_TOOLCHAIN_VERSION_BY_KIND[kind]
    const archivePath = join(
      this.resolveToolchainStoreDir(),
      kind,
      version,
      `${kind}-toolchain-${platform.os}-${platform.arch}.tar.gz`,
    )

    try {
      await access(archivePath, fsConstants.R_OK)
    } catch {
      throw new Error(
        `${kind} toolchain archive was not found at ${archivePath}. Set HARNESS_WORKER_TOOLCHAIN_STORE_DIR to a directory that contains prebuilt coding agent toolchains.`,
      )
    }

    return {
      archivePath,
      kind,
      version,
    }
  }

  private resolveToolchainStoreDir(): string {
    const configuredPath = this.configService.get<string>('HARNESS_WORKER_TOOLCHAIN_STORE_DIR')?.trim()
    if (configuredPath) {
      return configuredPath
    }

    return this.resolveDefaultToolchainStoreDir()
  }

  private resolveDefaultToolchainStoreDir(): string {
    const home = process.env.HOME?.trim()
    if (!home) {
      throw new Error(
        'Cannot resolve the default toolchain store directory because HOME is not set. Configure HARNESS_WORKER_TOOLCHAIN_STORE_DIR explicitly.',
      )
    }

    if (process.platform === 'darwin') {
      return join(home, 'Library', 'Caches', 'harness-kanban', 'toolchains')
    }

    const xdgCacheHome = process.env.XDG_CACHE_HOME?.trim()
    if (xdgCacheHome) {
      return join(xdgCacheHome, 'harness-kanban', 'toolchains')
    }

    return join(home, '.cache', 'harness-kanban', 'toolchains')
  }
}
