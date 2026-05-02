import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'

import { HarnessWorkerDevpodService, WorkspacePortForwardHandle } from '../devpod.service'
import { WorkspacePortForwardService } from '../workspace-port-forward.service'
import type { ChildProcess } from 'node:child_process'
import type { Server } from 'node:net'

describe('WorkspacePortForwardService', () => {
  let service: WorkspacePortForwardService
  let devpodService: jest.Mocked<HarnessWorkerDevpodService>
  const servers: Server[] = []

  beforeEach(() => {
    devpodService = {
      getWorkspaceNameForIssue: jest.fn(issueId => `harness-kanban-issue-${issueId}`),
      startWorkspacePortForward: jest.fn(async (workspaceName, localPort, targetPort) => {
        const server = createServer(socket => socket.end())
        servers.push(server)
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(localPort, '127.0.0.1', () => {
            server.off('error', reject)
            resolve()
          })
        })

        const childState: { exitCode: number | null; killed: boolean; signalCode: NodeJS.Signals | null } = {
          exitCode: null,
          killed: false,
          signalCode: null,
        }
        const child = new EventEmitter() as ChildProcess
        Object.defineProperties(child, {
          exitCode: {
            get: () => childState.exitCode,
          },
          killed: {
            get: () => childState.killed,
          },
          signalCode: {
            get: () => childState.signalCode,
          },
        })
        child.kill = jest.fn(() => {
          childState.killed = true
          childState.exitCode = 0
          server.close()
          child.emit('exit', 0, null)
          return true
        }) as ChildProcess['kill']

        return {
          workspaceName,
          localPort,
          targetPort,
          child,
          getStderr: () => '',
          isExited: () => child.exitCode !== null,
          stop: async () => {
            if (child.exitCode === null) {
              child.kill('SIGTERM')
            }
          },
        } satisfies WorkspacePortForwardHandle
      }),
    } as unknown as jest.Mocked<HarnessWorkerDevpodService>

    service = new WorkspacePortForwardService(devpodService)
  })

  afterEach(async () => {
    await Promise.allSettled(servers.map(server => new Promise(resolve => server.close(resolve))))
    servers.length = 0
  })

  it('starts and reuses a DevPod port forward for an issue', async () => {
    const first = await service.ensureForward(101, 6657)
    const second = await service.ensureForward(101, 6657)

    expect(first.localPort).toBe(second.localPort)
    expect(devpodService.getWorkspaceNameForIssue).toHaveBeenCalledWith(101)
    expect(devpodService.startWorkspacePortForward).toHaveBeenCalledTimes(1)
    expect(devpodService.startWorkspacePortForward).toHaveBeenCalledWith(
      'harness-kanban-issue-101',
      first.localPort,
      6657,
    )
  })

  it('stops active forwards on shutdown', async () => {
    const forward = await service.ensureForward(202, 6657)

    await service.onApplicationShutdown()

    expect(forward.handle.child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
