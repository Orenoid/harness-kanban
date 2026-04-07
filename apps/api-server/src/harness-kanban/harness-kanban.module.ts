import { DatabaseModule } from '@/database/database.module'
import { PRE_CREATE_ISSUE_HOOKS, PRE_UPDATE_ISSUE_HOOKS } from '@/issue/constants/hook.constants'
import { IssueModule } from '@/issue/issue.module'
import { PgmqModule } from '@/pgmq/pgmq.module'
import { Global, Module } from '@nestjs/common'
import { CodingAgentModule } from './coding-agent/coding-agent.module'
import { CodeBotAssigneeHook, CodeBotCreateHook, CodeBotStatusHook } from './kanban/hooks/issue-code-bot.hooks'
import { CodeBotAutoQueueListener, CodeBotIssueTriggerListener } from './kanban/listeners/issue-code-bot.listeners'

@Global()
@Module({
  imports: [CodingAgentModule, DatabaseModule, IssueModule, PgmqModule],
  providers: [
    CodeBotCreateHook,
    CodeBotAssigneeHook,
    CodeBotStatusHook,
    CodeBotAutoQueueListener,
    CodeBotIssueTriggerListener,
    {
      provide: PRE_CREATE_ISSUE_HOOKS,
      useFactory: (createHook: CodeBotCreateHook) => [createHook],
      inject: [CodeBotCreateHook],
    },
    {
      provide: PRE_UPDATE_ISSUE_HOOKS,
      useFactory: (assigneeHook: CodeBotAssigneeHook, statusHook: CodeBotStatusHook) => [assigneeHook, statusHook],
      inject: [CodeBotAssigneeHook, CodeBotStatusHook],
    },
  ],
  exports: [PRE_CREATE_ISSUE_HOOKS, PRE_UPDATE_ISSUE_HOOKS],
})
export class HarnessKanbanModule {}
