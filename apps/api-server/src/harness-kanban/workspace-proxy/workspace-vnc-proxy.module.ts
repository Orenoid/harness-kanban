import { Module } from '@nestjs/common'
import { WorkspaceVncProxyService } from './workspace-vnc-proxy.service'

@Module({
  providers: [WorkspaceVncProxyService],
  exports: [WorkspaceVncProxyService],
})
export class WorkspaceVncProxyModule {}
