import { CodingAgentService } from '@/coding-agent/coding-agent.service'
import {
  PreCreateIssueHook,
  PreCreateIssueHookContext,
  PreUpdateIssueHook,
  PreUpdateIssueHookContext,
} from '@/issue/types/hook.types'
import { ValidationResult } from '@/property/types/property.types'
import { SystemBotId } from '@/user/constants/user.constants'
import { Injectable } from '@nestjs/common'
import { SystemPropertyId } from '@repo/shared/property/constants'
import {
  CANCELED_STATUS_ID,
  CODE_BOT_ASSIGNMENT_ERROR,
  CODE_BOT_CODING_AGENT_CONFIGURATION_ERROR,
  CODE_BOT_REASSIGNMENT_ERROR,
  CODE_BOT_STATUS_ERROR,
  TODO_STATUS_ID,
} from '../constants/code-bot.constants'

// TODO planning, in_progres shouldn't be allowed
const CODE_BOT_ASSIGNABLE_STATUS_IDS = new Set([TODO_STATUS_ID, 'planning', 'in_progress'])
const CODE_BOT_CODING_AGENT_TYPE = 'codex' as const

const toNullableString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const validateCodeBotCodingAgentConfiguration = async (
  codingAgentService: CodingAgentService,
): Promise<ValidationResult> => {
  const hasConfiguredAgent = await codingAgentService.hasCodingAgentConfigured(CODE_BOT_CODING_AGENT_TYPE)
  if (hasConfiguredAgent) {
    return { valid: true }
  }

  return {
    valid: false,
    errors: [CODE_BOT_CODING_AGENT_CONFIGURATION_ERROR],
  }
}

@Injectable()
export class CodeBotCreateHook implements PreCreateIssueHook {
  constructor(private readonly codingAgentService: CodingAgentService) {}

  // Enforces that newly created Code Bot issues start in Todo.
  async execute(context: PreCreateIssueHookContext) {
    const assigneeId = toNullableString(context.getRequestedValue(SystemPropertyId.ASSIGNEE))
    if (assigneeId !== SystemBotId.CODE_BOT) {
      return { valid: true }
    }

    const statusId = toNullableString(context.getRequestedValue(SystemPropertyId.STATUS))
    if (statusId === TODO_STATUS_ID) {
      return validateCodeBotCodingAgentConfiguration(this.codingAgentService)
    }

    return {
      valid: false,
      errors: [CODE_BOT_ASSIGNMENT_ERROR],
    }
  }
}

@Injectable()
export class CodeBotAssigneeHook implements PreUpdateIssueHook {
  constructor(private readonly codingAgentService: CodingAgentService) {}

  // Limits Code Bot assignment to the statuses where automation can take over.
  async execute(context: PreUpdateIssueHookContext) {
    const assigneeId = toNullableString(context.getNextSetValue(SystemPropertyId.ASSIGNEE))
    if (assigneeId !== SystemBotId.CODE_BOT) {
      return { valid: true }
    }

    const currentStatusId = toNullableString(context.getCurrentValue(SystemPropertyId.STATUS))
    if (currentStatusId && CODE_BOT_ASSIGNABLE_STATUS_IDS.has(currentStatusId)) {
      return validateCodeBotCodingAgentConfiguration(this.codingAgentService)
    }

    return {
      valid: false,
      errors: [CODE_BOT_REASSIGNMENT_ERROR],
    }
  }
}

@Injectable()
export class CodeBotStatusHook implements PreUpdateIssueHook {
  // Prevents humans from changing a Code Bot owned issue except to cancel it.
  async execute(context: PreUpdateIssueHookContext) {
    const nextStatusId = toNullableString(context.getNextSetValue(SystemPropertyId.STATUS))
    if (!nextStatusId) {
      return { valid: true }
    }

    const currentAssigneeId = toNullableString(context.getCurrentValue(SystemPropertyId.ASSIGNEE))
    if (currentAssigneeId !== SystemBotId.CODE_BOT) {
      return { valid: true }
    }

    if (context.userId === SystemBotId.CODE_BOT) {
      return { valid: true }
    }

    if (nextStatusId === CANCELED_STATUS_ID) {
      return { valid: true }
    }

    return {
      valid: false,
      errors: [CODE_BOT_STATUS_ERROR],
    }
  }
}
