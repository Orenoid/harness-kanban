import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ConfigService } from '@nestjs/config'
import { HarnessWorkerToolchainService } from '../toolchain.service'

describe('HarnessWorkerToolchainService', () => {
  let configService: jest.Mocked<ConfigService>
  let service: HarnessWorkerToolchainService

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>
    service = new HarnessWorkerToolchainService(configService)
  })

  it('resolves a configured Codex toolchain archive path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'harness-kanban-toolchain-store-'))
    const archiveDir = join(root, 'codex', '0.116.0')
    const archivePath = join(archiveDir, 'codex-toolchain-linux-arm64.tar.gz')

    await mkdir(archiveDir, { recursive: true })
    await writeFile(archivePath, 'placeholder', 'utf8')

    configService.get.mockImplementation((key: string) => {
      if (key === 'HARNESS_WORKER_TOOLCHAIN_STORE_DIR') {
        return root
      }

      if (key === 'HARNESS_WORKER_CODEX_TOOLCHAIN_VERSION') {
        return '0.116.0'
      }

      return undefined
    })

    await expect(service.resolveCodexToolchainArtifact({ os: 'linux', arch: 'arm64' })).resolves.toEqual({
      archivePath,
      kind: 'codex',
      version: '0.116.0',
    })
  })

  it('throws when the configured Codex toolchain archive is missing', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'HARNESS_WORKER_TOOLCHAIN_STORE_DIR') {
        return '/tmp/missing-toolchain-store'
      }

      if (key === 'HARNESS_WORKER_CODEX_TOOLCHAIN_VERSION') {
        return '0.116.0'
      }

      return undefined
    })

    await expect(service.resolveCodexToolchainArtifact({ os: 'linux', arch: 'x64' })).rejects.toThrow(
      'codex toolchain archive was not found',
    )
  })
})
