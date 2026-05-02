import { getCorsAllowedOrigins } from '@/auth/auth-origins'
import { ApiExceptionFilter } from '@/common/filters/api-exception.filter'
import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { TEST } from '@repo/shared/constants'
// import { InitializationService } from './initialization/initialization.service'
import { AppModule } from './app.module.js'
import { WorkspaceVncProxyService } from './harness-kanban/workspace-proxy/workspace-vnc-proxy.service.js'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { Request, Response } from 'express'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  const config = app.get(ConfigService)

  const port = config.get<number>('PORT') || 3001
  const appEnv = config.get<string>('APP_ENV') || 'dev'
  const nodeEnv = config.get<string>('NODE_ENV') || 'development'

  const logger = new Logger('Bootstrap')

  logger.log(`Initializing API server...with constants: ${TEST}`)
  const allowedOrigins = getCorsAllowedOrigins()

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  })

  app.useGlobalFilters(new ApiExceptionFilter())
  const workspaceVncProxyService = app.get(WorkspaceVncProxyService)
  const httpAdapter = app.getHttpAdapter()
  const expressApp = httpAdapter.getInstance()

  expressApp.use('/api/v1/vnc', (req: Request, res: Response) => {
    void workspaceVncProxyService.handleHttpRequest(req, res)
  })

  app.getHttpServer().on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!workspaceVncProxyService.canHandleUrl(req.url)) {
      return
    }

    void workspaceVncProxyService.handleUpgradeRequest(req, socket, head)
  })

  logger.log(`Starting server on port ${port}`)
  logger.log(`APP_ENV=${appEnv} NODE_ENV=${nodeEnv}`)

  const enableSwagger = ['dev'].includes(appEnv)
  if (enableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Issue Server API')
      .setDescription('Issue Server API documentation')
      .setVersion('0.0.1')
      .build()

    const document = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup('api-docs', app, document)
    logger.log('Swagger docs available at /api-docs')
  }

  await app.listen(port)
}

void bootstrap()
