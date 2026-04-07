import { AuthModule } from '@/auth/auth.module'
import { DatabaseModule } from '@/database/database.module'
import { GithubModule } from '@/github/github.module'
import { CodingAgentModule } from '@/harness-kanban/coding-agent/coding-agent.module'
import { HarnessKanbanModule } from '@/harness-kanban/harness-kanban.module'
import { HarnessWorkerCodingAgentWorkflowService } from '@/harness-kanban/worker/coding-agent-workflow.service'
import { HarnessWorkerDevpodService } from '@/harness-kanban/worker/devpod.service'
import { HarnessWorkerGithubService } from '@/harness-kanban/worker/github.service'
import { HarnessWorkerCodingAgentProviderRegistry } from '@/harness-kanban/worker/providers/coding-agent-provider.registry'
import { HarnessWorkerClaudeCodeProvider } from '@/harness-kanban/worker/providers/harness-worker-claude-code.provider'
import { HarnessWorkerCodexProvider } from '@/harness-kanban/worker/providers/harness-worker-codex.provider'
import { HarnessWorkerToolchainService } from '@/harness-kanban/worker/toolchain.service'
import { WorkerService } from '@/harness-kanban/worker/worker.service'
import { IssueModule } from '@/issue/issue.module'
import { PgmqModule } from '@/pgmq/pgmq.module'
import { ProjectModule } from '@/project/project.module'
import { PropertyModule } from '@/property/property.module'
import { UserModule } from '@/user/user.module'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    CodingAgentModule,
    GithubModule,
    HarnessKanbanModule,
    PgmqModule,
    AuthModule,
    ProjectModule,
    PropertyModule,
    IssueModule,
    UserModule,
  ],
  providers: [
    HarnessWorkerDevpodService,
    HarnessWorkerToolchainService,
    HarnessWorkerCodexProvider,
    HarnessWorkerClaudeCodeProvider,
    HarnessWorkerCodingAgentProviderRegistry,
    HarnessWorkerCodingAgentWorkflowService,
    HarnessWorkerGithubService,
    WorkerService,
  ],
})
export class WorkerAppModule {}
