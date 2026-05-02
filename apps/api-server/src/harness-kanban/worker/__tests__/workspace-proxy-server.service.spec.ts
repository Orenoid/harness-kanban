import { createServer, get } from 'node:http'
import { createConnection } from 'node:net'

import { ConfigService } from '@nestjs/config'
import { WorkerService } from '../worker.service'
import { WorkspacePortForwardService } from '../workspace-port-forward.service'
import { WorkspaceProxyServerService } from '../workspace-proxy-server.service'
import type { Server } from 'node:http'

const listen = (server: Server, port = 0): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to listen'))
        return
      }
      resolve(address.port)
    })
  })

const readUrl = (url: string): Promise<string> =>
  new Promise((resolve, reject) => {
    get(url, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    }).on('error', reject)
  })

const readUpgrade = (port: number, path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'),
      )
    })
    const chunks: Buffer[] = []
    socket.on('data', chunk => chunks.push(chunk))
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    socket.on('error', reject)
  })

describe('WorkspaceProxyServerService', () => {
  let upstreamServer: Server
  let proxyService: WorkspaceProxyServerService

  afterEach(async () => {
    await proxyService?.onApplicationShutdown()
    await new Promise(resolve => upstreamServer?.close(resolve))
  })

  it('proxies an active issue to the local DevPod tunnel port', async () => {
    upstreamServer = createServer((req, res) => {
      res.end(req.url)
    })
    const upstreamPort = await listen(upstreamServer)
    const configService = {
      get: jest.fn(key => {
        if (key === 'HARNESS_WORKER_PROXY_HOST') {
          return '127.0.0.1'
        }
        if (key === 'HARNESS_WORKER_PROXY_PORT') {
          return '0'
        }
        return undefined
      }),
    } as unknown as jest.Mocked<ConfigService>
    const workerService = {
      get currentIssueId() {
        return 303
      },
    } as WorkerService
    const portForwardService = {
      ensureIssueVncForward: jest.fn().mockResolvedValue({
        issueId: 303,
        targetPort: 6657,
        localPort: upstreamPort,
      }),
    } as unknown as jest.Mocked<WorkspacePortForwardService>

    proxyService = new WorkspaceProxyServerService(configService, workerService, portForwardService)
    await proxyService.onApplicationBootstrap()

    const server = (proxyService as unknown as { server: Server }).server
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Proxy server did not bind to a TCP port')
    }

    const body = await readUrl(`http://127.0.0.1:${address.port}/internal/vnc/303/preview?token=abc`)

    expect(body).toBe('/preview?token=abc')
    expect(portForwardService.ensureIssueVncForward).toHaveBeenCalledWith(303)
  })

  it('proxies WebSocket upgrade requests to the local DevPod tunnel port', async () => {
    upstreamServer = createServer()
    upstreamServer.on('upgrade', (req, socket) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      socket.end(req.url)
    })
    const upstreamPort = await listen(upstreamServer)
    const configService = {
      get: jest.fn(key => {
        if (key === 'HARNESS_WORKER_PROXY_HOST') {
          return '127.0.0.1'
        }
        if (key === 'HARNESS_WORKER_PROXY_PORT') {
          return '0'
        }
        return undefined
      }),
    } as unknown as jest.Mocked<ConfigService>
    const workerService = {
      get currentIssueId() {
        return 303
      },
    } as WorkerService
    const portForwardService = {
      ensureIssueVncForward: jest.fn().mockResolvedValue({
        issueId: 303,
        targetPort: 6657,
        localPort: upstreamPort,
      }),
    } as unknown as jest.Mocked<WorkspacePortForwardService>

    proxyService = new WorkspaceProxyServerService(configService, workerService, portForwardService)
    await proxyService.onApplicationBootstrap()

    const server = (proxyService as unknown as { server: Server }).server
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Proxy server did not bind to a TCP port')
    }

    const response = await readUpgrade(address.port, '/internal/vnc/303/socket?token=abc')

    expect(response).toContain('101 Switching Protocols')
    expect(response).toContain('/socket?token=abc')
    expect(portForwardService.ensureIssueVncForward).toHaveBeenCalledWith(303)
  })
})
