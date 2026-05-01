/**
 * Agent Tool Input/Output Types
 *
 * These types define the input and output shapes for each tool.
 * Used by both frontend and backend for type safety.
 */

// ============================================
// Property & Issue Tools
// ============================================

export interface QueryPropertiesOutput {
  properties: Array<{
    id: string
    name: string
    type: string
    description?: string
    config?: Record<string, unknown>
    readonly?: boolean
    deletable?: boolean
  }>
}

export interface CreateIssueInput {
  issues: Array<{
    propertyValues: Array<{
      propertyId: string
      value: unknown
    }>
  }>
}

export interface CreateIssueOutput {
  results: Array<{
    issueId: number
    success: boolean
    errors?: string[]
  }>
}

export interface GetIssuesInput {
  filters?: Array<{
    propertyId: string
    operator: string
    operand?: unknown
    propertyType: string
  }>
  filterRelation?: 'and' | 'or'
  sort?: Array<{
    id: string
    desc: boolean
  }>
  page?: number
  pageSize?: number
}

export interface GetIssuesOutput {
  issues: Array<{
    issueId: number
    propertyValues: Array<{
      propertyId: string
      value: unknown
    }>
  }>
  total: number
}

export interface SemanticSearchIssuesInput {
  query: string
  page?: number
  pageSize?: number
}

export interface SemanticSearchIssuesOutput {
  issues: Array<{
    issueId: number
    propertyValues: Array<{
      propertyId: string
      value: unknown
    }>
  }>
  total: number
}

export interface GetIssueByIdInput {
  issueId: number
}

export interface GetIssueByIdOutput {
  issueId: number
  propertyValues: Array<{
    propertyId: string
    value: unknown
  }>
}

export interface UpdateIssueInput {
  issueId: number
  operations: Array<{
    propertyId: string
    operationType: string
    operationPayload: unknown
  }>
}

export interface UpdateIssueOutput {
  success: boolean
  issueId: number
  errors?: string[]
}

export interface DeleteIssueInput {
  issueId: number
}

export interface DeleteIssueOutput {
  success: boolean
  issueId: number
}

// ============================================
// Comment Tools
// ============================================

export interface GetCommentsInput {
  issueId: number
}

export interface CommentOutput {
  id: string
  issueId: number
  content: string
  createdBy: string
  parentId: string | null
  createdAt: number
  updatedAt: number
  subComments?: CommentOutput[]
}

export interface GetCommentsOutput {
  comments: CommentOutput[]
}

export interface CreateCommentInput {
  issueId: number
  content: string
  parentId?: string
}

export type CreateCommentOutput = CommentOutput

export interface UpdateCommentInput {
  commentId: string
  content: string
}

export type UpdateCommentOutput = CommentOutput

export interface DeleteCommentInput {
  commentId: string
}

export interface DeleteCommentOutput {
  success: boolean
  commentId: string
}

// ============================================
// Subscription Tools
// ============================================

export interface GetSubscribersInput {
  issueId: number
}

export interface GetSubscribersOutput {
  subscriberIds: string[]
}

export interface AddSubscriberInput {
  issueId: number
  userIds: string[]
}

export interface AddSubscriberOutput {
  success: boolean
}

export interface RemoveSubscriberInput {
  issueId: number
  userIds: string[]
}

export interface RemoveSubscriberOutput {
  success: boolean
}

// ============================================
// User Tools
// ============================================

export type GetAvailableUsersInput = Record<string, never>

export interface GetAvailableUsersOutput {
  id: string
  name: string
  email: string
}

export type GetCurrentUserInput = Record<string, never>

export interface GetCurrentUserOutput {
  id: string
}

// ============================================
// Todo List Tools
// ============================================

export interface TodoItem {
  id: string
  text: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

export type ListTodosInput = Record<string, never>

export interface ListTodosOutput {
  items: TodoItem[]
  count: number
  completedCount: number
}

export interface AddMultipleTodosInput {
  items: Array<{
    text: string
  }>
}

export interface AddMultipleTodosOutput {
  success: boolean
  todos: TodoItem[]
  count: number
}

export interface ToggleMultipleTodosInput {
  ids: string[]
}

export interface ToggleMultipleTodosOutput {
  success: boolean
  toggled: TodoItem[]
  notFound: string[]
  count: number
}

export interface DeleteMultipleTodosInput {
  ids: string[]
}

export interface DeleteMultipleTodosOutput {
  success: boolean
  deleted: TodoItem[]
  notFound: string[]
  remainingCount: number
}

// ============================================
// Chat State Types
// ============================================

export interface ChatState {
  todoList?: {
    items: TodoItem[]
  }
}
