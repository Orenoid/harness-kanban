import { AuthModule } from '@/auth/auth.module'
import { DatabaseModule } from '@/database/database.module'
import { GithubModule } from '@/github/github.module'
import { HarnessKanbanModule } from '@/harness-kanban/harness-kanban.module'
import { HealthModule } from '@/health/health.module'
import { IssueModule } from '@/issue/issue.module'
import { NotificationModule } from '@/notification/notification.module'
import { ProjectModule } from '@/project/project.module'
import { PropertyModule } from '@/property/property.module'
import { UserApiModule } from '@/user-api/user-api.module'
import { UserModule } from '@/user/user.module'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { AuthModule as BetterAuthNestModule } from '@thallesp/nestjs-better-auth'
import { AgentModule } from './agent/agent.module.js'
import { getAuth } from './auth/auth.js'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    HealthModule,
    HarnessKanbanModule,
    GithubModule,
    AuthModule,
    ProjectModule,
    PropertyModule,
    IssueModule,
    NotificationModule,
    UserModule,
    UserApiModule,
    AgentModule,
    BetterAuthNestModule.forRootAsync({
      useFactory: async () => {
        const authInstance = await getAuth()
        return {
          auth: authInstance,
        }
      },
    }),
  ],
})
export class AppModule {}
