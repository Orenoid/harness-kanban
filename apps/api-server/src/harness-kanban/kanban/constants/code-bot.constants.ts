export const CODE_BOT_ASSIGNMENT_ERROR = 'Code Bot can only be assigned to issues in Todo status'
// FIXME: shouldn't be able to assign to issues in 'planning', 'in progress' status (maybe?)
export const CODE_BOT_REASSIGNMENT_ERROR =
  'Code Bot can only be assigned to issues in Todo, Planning, or In Progress status'
export const CODE_BOT_CODING_AGENT_CONFIGURATION_ERROR =
  'Code Bot requires at least one Codex coding agent configuration. Go to Settings > Coding Agents (/settings/coding-agents) to add one.'
export const CODE_BOT_STATUS_ERROR = 'This issue is currently controlled by Code Bot. You can only cancel it.'
export const TODO_STATUS_ID = 'todo'
export const CANCELED_STATUS_ID = 'canceled'
