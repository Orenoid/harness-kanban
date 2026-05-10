import { request as httpRequest } from 'node:http'
import { createConnection } from 'node:net'
import { URL } from 'node:url'

import { PrismaService } from '@/database/prisma.service'
import { DEFAULT_HARNESS_WORKER_STALE_TIMEOUT_MS } from '@/harness-kanban/worker/worker.constants'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DEFAULT_WORKSPACE_ID } from '@repo/shared'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

type ParsedProxyTarget = {
  issueId: number
  path: string
}

type WorkerProxyTarget = {
  baseUrl: URL
}

@Injectable()
export class WorkspaceVncProxyService {
  private readonly logger = new Logger(WorkspaceVncProxyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  canHandleUrl(rawUrl: string | undefined): boolean {
    return this.parseTarget(rawUrl) !== null
  }

  async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = this.parseTarget(req.url)
    if (!target) {
      res.writeHead(404)
      res.end('Not found')
      return
    }

    try {
      const worker = await this.resolveWorkerProxyTarget(target.issueId)
      const upstreamPath = this.buildWorkerPath(worker.baseUrl, target)
      const upstream = httpRequest(
        {
          protocol: worker.baseUrl.protocol,
          hostname: worker.baseUrl.hostname,
          port: worker.baseUrl.port,
          method: req.method,
          path: upstreamPath,
          headers: this.buildProxyRequestHeaders(req.headers, worker.baseUrl.host),
        },
        upstreamRes => {
          if (this.shouldInjectHtmlBase(upstreamRes.headers)) {
            const chunks: Buffer[] = []
            upstreamRes.on('data', chunk => chunks.push(chunk))
            upstreamRes.on('end', () => {
              const body = this.injectHtmlBase(Buffer.concat(chunks).toString('utf8'), target.issueId)
              const headers = this.filterResponseHeaders(upstreamRes.headers)
              headers['content-length'] = Buffer.byteLength(body).toString()
              res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, headers)
              res.end(body)
            })
            return
          }

          res.writeHead(
            upstreamRes.statusCode ?? 502,
            upstreamRes.statusMessage,
            this.filterResponseHeaders(upstreamRes.headers),
          )
          upstreamRes.pipe(res)
        },
      )

      upstream.on('error', error => {
        if (!res.headersSent) {
          res.writeHead(502)
        }
        res.end(`Worker proxy error: ${error.message}`)
      })

      req.pipe(upstream)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Failed to proxy VNC HTTP request for issue ${target.issueId}: ${message}`)
      res.writeHead(message.includes('not found') ? 404 : 503)
      res.end(message)
    }
  }

  async handleUpgradeRequest(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    const target = this.parseTarget(req.url)
    if (!target) {
      this.rejectUpgrade(socket, 404, 'Not found')
      return
    }

    socket.pause()

    try {
      const worker = await this.resolveWorkerProxyTarget(target.issueId)
      const upstream = createConnection({
        host: worker.baseUrl.hostname,
        port: this.getUrlPort(worker.baseUrl),
      })

      upstream.once('connect', () => {
        upstream.write(
          this.serializeUpgradeRequest(req, this.buildWorkerPath(worker.baseUrl, target), worker.baseUrl.host),
        )
        if (head.length > 0) {
          upstream.write(head)
        }

        socket.pipe(upstream)
        upstream.pipe(socket)
        socket.resume()
      })

      upstream.once('error', error => {
        this.logger.warn(`Failed to open worker upgrade proxy for issue ${target.issueId}: ${error.message}`)
        this.rejectUpgrade(socket, 502, 'Worker proxy error')
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`Failed to proxy VNC upgrade request for issue ${target.issueId}: ${message}`)
      this.rejectUpgrade(socket, message.includes('not found') ? 404 : 503, message)
    }
  }

  private async resolveWorkerProxyTarget(issueId: number): Promise<WorkerProxyTarget> {
    const issue = await this.prisma.client.issue.findFirst({
      where: {
        id: issueId,
        workspace_id: DEFAULT_WORKSPACE_ID,
        deleted_at: null,
      },
      select: {
        id: true,
      },
    })

    if (!issue) {
      throw new Error(`Issue ${issueId} was not found`)
    }

    const worker = await this.prisma.client.harness_worker.findFirst({
      where: {
        issue_id: issueId,
      },
      select: {
        proxy_base_url: true,
        last_updated_at: true,
      },
    })

    if (!worker?.proxy_base_url) {
      throw new Error(`Worker proxy for issue ${issueId} is unavailable`)
    }

    if (Date.now() - worker.last_updated_at.getTime() > this.getWorkerStaleTimeoutMs()) {
      throw new Error(`Worker proxy for issue ${issueId} is stale`)
    }

    const baseUrl = new URL(worker.proxy_base_url)
    if (baseUrl.protocol !== 'http:') {
      throw new Error(`Unsupported worker proxy protocol: ${baseUrl.protocol}`)
    }

    return {
      baseUrl,
    }
  }

  private parseTarget(rawUrl: string | undefined): ParsedProxyTarget | null {
    const url = new URL(rawUrl ?? '/', 'http://api.local')
    let pathname = url.pathname
    if (pathname.startsWith('/api/v1/vnc/')) {
      pathname = pathname.slice('/api/v1/vnc'.length)
    }

    const match = /^\/([1-9]\d*)(?:\/(.*))?$/.exec(pathname)
    if (!match) {
      return null
    }

    const pathSuffix = match[2] ? `/${match[2]}` : '/'
    return {
      issueId: Number(match[1]),
      path: `${pathSuffix}${url.search}`,
    }
  }

  private buildWorkerPath(baseUrl: URL, target: ParsedProxyTarget): string {
    const basePath = baseUrl.pathname === '/' ? '' : baseUrl.pathname.replace(/\/$/, '')
    return `${basePath}/internal/vnc/${target.issueId}${target.path}`
  }

  private buildProxyRequestHeaders(headers: IncomingHttpHeaders, host: string): IncomingHttpHeaders {
    const nextHeaders = this.filterHeaders(headers)
    nextHeaders.host = host
    nextHeaders['x-forwarded-host'] = headers.host
    nextHeaders['x-forwarded-prefix'] = '/vnc'
    delete nextHeaders['accept-encoding']
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

  private filterResponseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
    const nextHeaders = this.filterHeaders(headers)
    delete nextHeaders['content-length']
    delete nextHeaders['content-encoding']
    delete nextHeaders.etag
    return nextHeaders
  }

  private shouldInjectHtmlBase(headers: IncomingHttpHeaders): boolean {
    const contentType = headers['content-type']
    const value = Array.isArray(contentType) ? contentType.join(';') : contentType
    return typeof value === 'string' && value.toLowerCase().includes('text/html')
  }

  private injectHtmlBase(body: string, issueId: number): string {
    if (/<base\s/i.test(body)) {
      return body
    }

    const baseTag = [
      `<base href="/vnc/${issueId}/">`,
      `<script>${this.buildVncWebSocketPatchScript(issueId)}</script>`,
    ].join('')
    if (/<head[^>]*>/i.test(body)) {
      return body.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
    }

    return `${baseTag}${body}`
  }

  private buildVncWebSocketPatchScript(issueId: number): string {
    return [
      '(() => {',
      '  const NativeWebSocket = window.WebSocket;',
      `  const prefix = "/vnc/${issueId}/";`,
      '  const rewrite = value => {',
      '    if (typeof value !== "string") return value;',
      '    try {',
      '      const url = new URL(value, window.location.href);',
      '      if (url.pathname === "/vnc/websockets") {',
      '        url.pathname = `${prefix}websockets`;',
      '        return url.href;',
      '      }',
      '    } catch {}',
      '    return value;',
      '  };',
      '  window.WebSocket = function WebSocket(url, protocols) {',
      '    return protocols === undefined ? new NativeWebSocket(rewrite(url)) : new NativeWebSocket(rewrite(url), protocols);',
      '  };',
      '  window.WebSocket.prototype = NativeWebSocket.prototype;',
      '  Object.assign(window.WebSocket, NativeWebSocket);',
      '})();',
    ].join('')
  }

  private rejectUpgrade(socket: Socket, statusCode: number, message: string): void {
    socket.end(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  }

  private getWorkerStaleTimeoutMs(): number {
    const value = this.configService.get<string | number>('HARNESS_WORKER_STALE_TIMEOUT_MS')
    if (typeof value === 'number') {
      return value
    }

    const parsed = value ? Number.parseInt(value, 10) : NaN
    return Number.isFinite(parsed) ? parsed : DEFAULT_HARNESS_WORKER_STALE_TIMEOUT_MS
  }

  private getUrlPort(url: URL): number {
    if (url.port) {
      return Number.parseInt(url.port, 10)
    }

    return 80
  }
}
