import { AuthModule } from '@/auth/auth.module'
import { CodingAgentModule } from '@/coding-agent/coding-agent.module'
import { DatabaseModule } from '@/database/database.module'
import { GithubModule } from '@/github/github.module'
import { HarnessKanbanModule } from '@/harness-kanban/harness-kanban.module'
import { HarnessKanbanService } from '@/harness-kanban/worker/harness-kanban.service'
import { HarnessWorkerCodexRunnerService } from '@/harness-kanban/worker/harness-worker-codex-runner.service'
import { HarnessWorkerCodexWorkflowService } from '@/harness-kanban/worker/harness-worker-codex-workflow.service'
import { HarnessWorkerDevpodService } from '@/harness-kanban/worker/harness-worker-devpod.service'
import { HarnessWorkerGithubService } from '@/harness-kanban/worker/harness-worker-github.service'
import { HarnessWorkerRegistryService } from '@/harness-kanban/worker/harness-worker-registry.service'
import { HarnessWorkerToolchainService } from '@/harness-kanban/worker/harness-worker-toolchain.service'
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
    HarnessWorkerRegistryService,
    HarnessWorkerDevpodService,
    HarnessWorkerToolchainService,
    HarnessWorkerCodexRunnerService,
    HarnessWorkerCodexWorkflowService,
    HarnessWorkerGithubService,
    HarnessKanbanService,
  ],
})
export class WorkerAppModule {}
