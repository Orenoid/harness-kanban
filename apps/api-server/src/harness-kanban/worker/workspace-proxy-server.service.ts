import { createServer, request } from 'node:http'
import { createConnection } from 'node:net'
import { URL } from 'node:url'

import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DEFAULT_HARNESS_WORKER_PROXY_HOST, DEFAULT_HARNESS_WORKER_PROXY_PORT } from './worker.constants'
import { WorkerService } from './worker.service'
import { WorkspacePortForwardService } from './workspace-port-forward.service'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

type ParsedProxyTarget = {
  issueId: number
  path: string
}

@Injectable()
export class WorkspaceProxyServerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkspaceProxyServerService.name)
  private server: Server | null = null

  constructor(
    private readonly configService: ConfigService,
    private readonly workerService: WorkerService,
    private readonly portForwardService: WorkspacePortForwardService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.server) {
      return
    }

    const host =
      this.configService.get<string>('HARNESS_WORKER_PROXY_HOST')?.trim() || DEFAULT_HARNESS_WORKER_PROXY_HOST
    const port = this.getConfiguredPort()
    const server = createServer((req, res) => {
      void this.handleHttpRequest(req, res)
    })

    server.on('upgrade', (req, socket, head) => {
      void this.handleUpgradeRequest(req, socket as Socket, head)
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.off('error', reject)
        resolve()
      })
    })

    this.server = server
    this.logger.log(`Workspace proxy server listening on ${host}:${port}`)
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server
    if (!server) {
      return
    }

    this.server = null
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = this.parseTarget(req.url)
    if (!target) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    if (!this.canServeIssue(target.issueId)) {
      res.writeHead(404)
      res.end('Workspace is not active on this worker')
      return
    }

    try {
      const forward = await this.portForwardService.ensureIssueVncForward(target.issueId)
      const upstream = request(
        {
          host: '127.0.0.1',
          port: forward.localPort,
          method: req.method,
          path: target.path,
          headers: this.buildProxyRequestHeaders(req.headers, `127.0.0.1:${forward.localPort}`),
        },
        upstreamRes => {
          res.writeHead(
            upstreamRes.statusCode ?? 502,
            upstreamRes.statusMessage,
            this.filterHeaders(upstreamRes.headers),
          )
          upstreamRes.pipe(res)
        },
      )

      upstream.on('error', error => {
        if (!res.headersSent) {
          res.writeHead(502)
        }
        res.end(`Workspace proxy error: ${error.message}`)
      })

      req.pipe(upstream)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Failed to proxy workspace HTTP request for issue ${target.issueId}: ${message}`)
      res.writeHead(503)
      res.end('Workspace proxy unavailable')
    }
  }

  private async handleUpgradeRequest(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    const target = this.parseTarget(req.url)
    if (!target) {
      this.rejectUpgrade(socket, 404, 'Not found')
      return
    }

    if (!this.canServeIssue(target.issueId)) {
      this.rejectUpgrade(socket, 404, 'Workspace is not active on this worker')
      return
    }

    socket.pause()

    try {
      const forward = await this.portForwardService.ensureIssueVncForward(target.issueId)
      const upstream = createConnection({ host: '127.0.0.1', port: forward.localPort })

      upstream.once('connect', () => {
        upstream.write(this.serializeUpgradeRequest(req, target.path, `127.0.0.1:${forward.localPort}`))
        if (head.length > 0) {
          upstream.write(head)
        }

        socket.pipe(upstream)
        upstream.pipe(socket)
        socket.resume()
      })

      upstream.once('error', error => {
        this.logger.warn(`Failed to open workspace upgrade proxy for issue ${target.issueId}: ${error.message}`)
        this.rejectUpgrade(socket, 502, 'Workspace proxy error')
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Failed to proxy workspace upgrade request for issue ${target.issueId}: ${message}`)
      this.rejectUpgrade(socket, 503, 'Workspace proxy unavailable')
    }
  }

  private parseTarget(rawUrl: string | undefined): ParsedProxyTarget | null {
    const url = new URL(rawUrl ?? '/', 'http://worker.local')
    const match = /^\/internal\/vnc\/([1-9]\d*)(?:\/(.*))?$/.exec(url.pathname)
    if (!match) {
      return null
    }

    const pathSuffix = match[2] ? `/${match[2]}` : '/'
    return {
      issueId: Number(match[1]),
      path: `${pathSuffix}${url.search}`,
    }
  }

  private canServeIssue(issueId: number): boolean {
    return this.workerService.currentIssueId === issueId
  }

  private buildProxyRequestHeaders(headers: IncomingHttpHeaders, host: string): IncomingHttpHeaders {
    const nextHeaders = this.filterHeaders(headers)
    nextHeaders.host = host
    nextHeaders['x-forwarded-host'] = headers.host
    nextHeaders['x-forwarded-prefix'] = '/vnc'
    return nextHeaders
  }

  private serializeUpgradeRequest(req: IncomingMessage, path: string, host: string): string {
    const headers = this.buildProxyRequestHeaders(req.headers, host)
    headers.connection = 'Upgrade'
    headers.upgrade = req.headers.upgrade ?? 'websocket'

    const lines = [`${req.method ?? 'GET'} ${path} HTTP/${req.httpVersion}`]
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        value.forEach(item => lines.push(`${key}: ${item}`))
      } else if (value !== undefined) {
        lines.push(`${key}: ${value}`)
      }
    }

    return `${lines.join('\r\n')}\r\n\r\n`
  }

  private filterHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
    const hopByHop = new Set([
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'proxy-connection',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
    ])

    return Object.fromEntries(Object.entries(headers).filter(([key]) => !hopByHop.has(key.toLowerCase())))
  }

  private rejectUpgrade(socket: Socket, statusCode: number, message: string): void {
    socket.end(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  }

  private getConfiguredPort(): number {
    const value = this.configService.get<string | number>('HARNESS_WORKER_PROXY_PORT')
    if (typeof value === 'number') {
      return value
    }

    const parsed = value ? Number.parseInt(value, 10) : NaN
    return Number.isFinite(parsed) ? parsed : DEFAULT_HARNESS_WORKER_PROXY_PORT
  }
}
