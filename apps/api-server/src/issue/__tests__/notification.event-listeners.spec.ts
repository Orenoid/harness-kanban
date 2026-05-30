import { PrismaService } from '@/database/prisma.service'
import { IssueService } from '@/issue/issue.service'
import { NotificationService } from '@/notification/notification.service'
import { UserService } from '@/user/user.service'
import { IssueNotificationEventListeners } from '../event-listeners/notification.event-listeners'

describe('IssueNotificationEventListeners', () => {
  let listeners: IssueNotificationEventListeners

  beforeEach(() => {
    listeners = new IssueNotificationEventListeners(
      {} as jest.Mocked<PrismaService>,
      {} as jest.Mocked<UserService>,
      {} as jest.Mocked<NotificationService>,
      {} as jest.Mocked<IssueService>,
    )
  })

  it('uses plain-text comments directly when building notification excerpts', () => {
    const excerpt = (listeners as any).buildCommentExcerpt(
      'Plain-text bot comment asking for clarification on acceptance criteria.',
    )

    expect(excerpt).toContain('Plain-text bot comment asking for clarification')
  })
})
