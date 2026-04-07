import { AuthModule } from '@/auth/auth.module'
import { DatabaseModule } from '@/database/database.module'
import { Module } from '@nestjs/common'
import { CodingAgentManagementRegistry } from './coding-agent-management.registry'
import { CodingAgentSnapshotService } from './coding-agent-snapshot.service'
import { CodingAgentController } from './coding-agent.controller'
import { CodingAgentService } from './coding-agent.service'

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CodingAgentController],
  providers: [CodingAgentService, CodingAgentSnapshotService, CodingAgentManagementRegistry],
  exports: [CodingAgentService, CodingAgentSnapshotService, CodingAgentManagementRegistry],
})
export class CodingAgentModule {}
