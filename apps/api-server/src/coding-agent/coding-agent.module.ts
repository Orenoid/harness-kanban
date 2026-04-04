import { AuthModule } from '@/auth/auth.module'
import { DatabaseModule } from '@/database/database.module'
import { Module } from '@nestjs/common'
import { CodingAgentController } from './coding-agent.controller'
import { CodingAgentService } from './coding-agent.service'

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CodingAgentController],
  providers: [CodingAgentService],
  exports: [CodingAgentService],
})
export class CodingAgentModule {}
