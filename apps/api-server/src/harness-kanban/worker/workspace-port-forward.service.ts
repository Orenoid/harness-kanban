import { createConnection, createServer } from 'node:net'

import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common'
import { HarnessWorkerDevpodService, WorkspacePortForwardHandle } from './devpod.service'
import { DEFAULT_HARNESS_WORKER_VNC_TARGET_PORT } from './worker.constants'

type WorkspacePortForward = {
  issueId: number
  targetPort: number
  localPort: number
  handle: WorkspacePortForwardHandle
}

@Injectable()
export class WorkspacePortForwardService implements OnApplicationShutdown {
  private readonly logger = new Logger(WorkspacePortForwardService.name)
  private readonly forwards = new Map<string, Promise<WorkspacePortForward>>()

  constructor(private readonly devpodService: HarnessWorkerDevpodService) {}

  async ensureIssueVncForward(issueId: number): Promise<WorkspacePortForward> {
    return this.ensureForward(issueId, DEFAULT_HARNESS_WORKER_VNC_TARGET_PORT)
  }

  async ensureForward(issueId: number, targetPort: number): Promise<WorkspacePortForward> {
    const key = this.buildKey(issueId, targetPort)
    const existing = this.forwards.get(key)
    if (existing) {
      const forward = await existing
      if (!forward.handle.isExited()) {
        return forward
      }

      await forward.handle.stop()
      this.forwards.delete(key)
    }

    const next = this.createForward(issueId, targetPort, key).catch(error => {
      this.forwards.delete(key)
      throw error
    })
    this.forwards.set(key, next)

    return next
  }

  async onApplicationShutdown(): Promise<void> {
    const forwards = await Promise.allSettled([...this.forwards.values()])
    await Promise.all(
      forwards
        .filter((result): result is PromiseFulfilledResult<WorkspacePortForward> => result.status === 'fulfilled')
        .map(result => result.value.handle.stop()),
    )
    this.forwards.clear()
  }

  private async createForward(issueId: number, targetPort: number, key: string): Promise<WorkspacePortForward> {
    const localPort = await this.allocateLocalPort()
    const workspaceName = this.devpodService.getWorkspaceNameForIssue(issueId)
    const handle = await this.devpodService.startWorkspacePortForward(workspaceName, localPort, targetPort)

    handle.child.once('exit', () => {
      this.forwards.delete(key)
    })

    await this.waitForLocalPort(handle)

    this.logger.log(`Started workspace port forward for issue ${issueId}: 127.0.0.1:${localPort} -> ${targetPort}`)

    return {
      issueId,
      targetPort,
      localPort,
      handle,
    }
  }

  private async allocateLocalPort(): Promise<number> {
    const server = createServer()

    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        server.close(error => {
          if (error) {
            reject(error)
            return
          }

          if (!address || typeof address === 'string') {
            reject(new Error('Failed to allocate local TCP port'))
            return
          }

          resolve(address.port)
        })
      })
    })
  }

  private async waitForLocalPort(handle: WorkspacePortForwardHandle): Promise<void> {
    const deadline = Date.now() + 10_000

    while (Date.now() < deadline) {
      if (handle.isExited()) {
        throw new Error(
          `DevPod port forward for ${handle.workspaceName} exited before listening: ${handle.getStderr().trim()}`,
        )
      }

      if (await this.canConnect(handle.localPort)) {
        return
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }

    await handle.stop()
    throw new Error(`Timed out waiting for DevPod port forward for ${handle.workspaceName}`)
  }

  private async canConnect(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        resolve(false)
      })
      socket.setTimeout(500, () => {
        socket.destroy()
        resolve(false)
      })
    })
  }

  private buildKey(issueId: number, targetPort: number): string {
    return `${issueId}:${targetPort}`
  }
}
