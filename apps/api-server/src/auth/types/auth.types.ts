import type { User as IssueUser } from '@/user/types/user.types'

export interface AuthContext {
  user: IssueUser
  organization?: unknown
}
