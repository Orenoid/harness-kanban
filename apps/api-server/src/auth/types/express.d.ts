import type { User as IssueUser } from '@/user/types/user.types'

declare global {
  namespace Express {
    interface Request {
      user?: IssueUser | undefined
      organization?: unknown
    }
  }
}

export {}
