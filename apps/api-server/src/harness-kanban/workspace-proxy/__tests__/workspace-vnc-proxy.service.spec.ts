import { createServer, get } from 'node:http'
import { createConnection } from 'node:net'

import { PrismaService } from '@/database/prisma.service'
import { ConfigService } from '@nestjs/config'
import { WorkspaceVncProxyService } from '../workspace-vnc-proxy.service'
import type { Server } from 'node:http'
import type { Socket } from 'node:net'

const listen = (server: Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
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

describe('WorkspaceVncProxyService', () => {
  let workerServer: Server
  let apiServer: Server

  afterEach(async () => {
    await new Promise(resolve => apiServer?.close(resolve))
    await new Promise(resolve => workerServer?.close(resolve))
  })

  it('proxies issue VNC requests to the owning worker proxy URL', async () => {
    workerServer = createServer((req, res) => {
      res.end(req.url)
    })
    const workerPort = await listen(workerServer)
    const prismaService = {
      client: {
        issue: {
          findFirst: jest.fn().mockResolvedValue({ id: 404 }),
        },
        harness_worker: {
          findFirst: jest.fn().mockResolvedValue({
            proxy_base_url: `http://127.0.0.1:${workerPort}`,
            last_updated_at: new Date(),
          }),
        },
      },
    } as unknown as jest.Mocked<PrismaService>
    const configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>
    const service = new WorkspaceVncProxyService(prismaService, configService)

    apiServer = createServer((req, res) => {
      void service.handleHttpRequest(req, res)
    })
    const apiPort = await listen(apiServer)

    const body = await readUrl(`http://127.0.0.1:${apiPort}/api/v1/vnc/404/preview?token=abc`)

    expect(body).toBe('/internal/vnc/404/preview?token=abc')
    expect(prismaService.client.issue.findFirst).toHaveBeenCalledWith({
      where: {
        id: 404,
        workspace_id: 'default-workspace-id',
        deleted_at: null,
      },
      select: {
        id: true,
      },
    })
  })

  it('injects an issue-scoped base tag into proxied HTML documents', async () => {
    workerServer = createServer((req, res) => {
      expect(req.headers['accept-encoding']).toBeUndefined()
      res.setHeader('content-type', 'text/html')
      res.end('<!doctype html><html><head><script src="./assets/app.js"></script></head><body></body></html>')
    })
    const workerPort = await listen(workerServer)
    const prismaService = {
      client: {
        issue: {
          findFirst: jest.fn().mockResolvedValue({ id: 404 }),
        },
        harness_worker: {
          findFirst: jest.fn().mockResolvedValue({
            proxy_base_url: `http://127.0.0.1:${workerPort}`,
            last_updated_at: new Date(),
          }),
        },
      },
    } as unknown as jest.Mocked<PrismaService>
    const configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>
    const service = new WorkspaceVncProxyService(prismaService, configService)

    apiServer = createServer((req, res) => {
      void service.handleHttpRequest(req, res)
    })
    const apiPort = await listen(apiServer)

    const body = await readUrl(`http://127.0.0.1:${apiPort}/api/v1/vnc/404`)

    expect(body).toContain('<base href="/vnc/404/">')
    expect(body).toContain('url.pathname === "/vnc/websockets"')
    expect(body).toContain('const prefix = "/vnc/404/";')
    expect(body).toContain('<script src="./assets/app.js"></script>')
  })

  it('proxies WebSocket upgrade requests to the owning worker proxy URL', async () => {
    workerServer = createServer()
    workerServer.on('upgrade', (req, socket) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      socket.end(req.url)
    })
    const workerPort = await listen(workerServer)
    const prismaService = {
      client: {
        issue: {
          findFirst: jest.fn().mockResolvedValue({ id: 404 }),
        },
        harness_worker: {
          findFirst: jest.fn().mockResolvedValue({
            proxy_base_url: `http://127.0.0.1:${workerPort}`,
            last_updated_at: new Date(),
          }),
        },
      },
    } as unknown as jest.Mocked<PrismaService>
    const configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>
    const service = new WorkspaceVncProxyService(prismaService, configService)

    apiServer = createServer((req, res) => {
      void service.handleHttpRequest(req, res)
    })
    apiServer.on('upgrade', (req, socket, head) => {
      void service.handleUpgradeRequest(req, socket as Socket, head)
    })
    const apiPort = await listen(apiServer)

    const response = await readUpgrade(apiPort, '/api/v1/vnc/404/socket?token=abc')

    expect(response).toContain('101 Switching Protocols')
    expect(response).toContain('/internal/vnc/404/socket?token=abc')
  })
})
