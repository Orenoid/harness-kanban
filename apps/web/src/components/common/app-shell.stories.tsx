import React, { useState } from 'react'

import { NotificationBellView } from '@/notification/components/notification-bell'
import { NotificationInboxPanelView } from '@/notification/components/notification-inbox-panel'
import { InboxNotificationListItem, NotificationChannelType, NotificationType } from '@repo/shared'
import { AppSidebarView } from './app-shell'
import { UserButtonCustomView } from './user-button-custom'
import type { Meta, StoryObj } from '@storybook/nextjs'

const SidebarStoryShell = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-background flex h-screen w-full">
    {children}
    <div className="flex-1 border-l border-dashed" />
  </div>
)

const userButtonClassNames = {
  trigger: {
    base: 'h-10 w-10 rounded-xl border border-transparent p-0 hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent',
    avatar: 'rounded-xl',
  },
  content: {
    base: 'ml-2',
  },
} as const

const notificationItems: InboxNotificationListItem[] = [
  {
    deliveryId: 'story-delivery-1',
    channelType: NotificationChannelType.INBOX,
    type: NotificationType.ISSUE_UPDATED,
    createdAt: Date.now(),
    readAt: null,
    payload: {
      actor: {
        id: 'user-1',
        username: 'Taylor',
        imageUrl: '',
        hasImage: false,
      },
      issue: {
        issueId: 32,
        title: 'Dark mode spacing regression',
      },
      changedProperties: [
        { propertyId: 'status', name: 'Status' },
        { propertyId: 'assignee', name: 'Assignee' },
      ],
    },
  },
]

const InteractiveSidebarStory = ({
  pathname,
  initialTheme,
  initialUserMenuOpen = false,
}: {
  pathname: string
  initialTheme: 'light' | 'dark'
  initialUserMenuOpen?: boolean
}) => {
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme)
  const [userMenuOpen, setUserMenuOpen] = useState(initialUserMenuOpen)
  const [notificationOpen, setNotificationOpen] = useState(false)

  return (
    <AppSidebarView
      pathname={pathname}
      mounted={true}
      theme={theme}
      onToggleTheme={() => {
        setTheme(currentTheme => (currentTheme === 'dark' ? 'light' : 'dark'))
      }}
      notificationControl={
        <NotificationBellView
          open={notificationOpen}
          unreadCount={3}
          onOpenChange={setNotificationOpen}
          panel={
            <NotificationInboxPanelView
              items={notificationItems}
              unreadCount={3}
              desktopNotificationPermission="granted"
              isRequestingDesktopNotificationPermission={false}
              isLoading={false}
              isFetchingNextPage={false}
              hasNextPage={false}
              isMarkAllPending={false}
              onEnableDesktopNotifications={() => {}}
              onSelect={() => {}}
              onMarkRead={() => {}}
              onMarkAllRead={() => {}}
            />
          }
        />
      }
      userControl={
        <UserButtonCustomView
          size="icon"
          align="start"
          side="right"
          open={userMenuOpen}
          onOpenChange={setUserMenuOpen}
          user={{
            id: 'story-user',
            name: 'Sidebar Reviewer',
            email: 'reviewer@example.com',
            image: null,
          }}
          mounted={true}
          isPending={false}
          signOutPending={false}
          onSignOut={async () => {}}
          classNames={userButtonClassNames}
        />
      }
    />
  )
}

const meta: Meta<typeof AppSidebarView> = {
  title: 'Common/AppSidebar',
  component: AppSidebarView,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    Story => (
      <SidebarStoryShell>
        <Story />
      </SidebarStoryShell>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof meta>

const assertElement = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message)
  }
}

const waitForCondition = async (predicate: () => boolean, timeoutMs = 1500, intervalMs = 50) => {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  throw new Error('Timed out waiting for condition.')
}

export const Default: Story = {
  render: () => <InteractiveSidebarStory pathname="/projects" initialTheme="light" />,
  play: async ({ canvasElement, userEvent }) => {
    const ownerDocument = canvasElement.ownerDocument

    await waitForCondition(() => Boolean(ownerDocument.querySelector('[aria-label="Harness Kanban"]')))

    const harnessKanbanLink = ownerDocument.querySelector('[aria-label="Harness Kanban"]')
    const issuesLink = ownerDocument.querySelector('[aria-label="Issues"]')
    const projectsLink = ownerDocument.querySelector('[aria-label="Projects"]')
    const settingsLink = ownerDocument.querySelector('[aria-label="Settings"]')
    const themeButton = ownerDocument.querySelector('[aria-label="Toggle theme"]') as HTMLElement | null
    const notificationButton = ownerDocument.querySelector('[aria-label="Notifications"]') as HTMLElement | null
    const userButton = ownerDocument.querySelector('[aria-haspopup="menu"]') as HTMLElement | null

    assertElement(harnessKanbanLink, 'Expected the Harness Kanban logo link to render.')
    assertElement(!issuesLink, 'Expected the Issues icon link to be hidden.')
    assertElement(projectsLink, 'Expected the Projects icon link to render.')
    assertElement(settingsLink, 'Expected the Settings icon link to render.')
    assertElement(projectsLink?.getAttribute('aria-current') === 'page', 'Expected Projects to be the active route.')
    assertElement(themeButton, 'Expected the theme toggle button to render.')
    assertElement(notificationButton, 'Expected the notification trigger button to render.')
    assertElement(canvasElement.textContent?.includes('3'), 'Expected the unread count badge to render.')
    assertElement(userButton, 'Expected the account trigger button to render.')
    assertElement(
      settingsLink?.parentElement === themeButton?.parentElement &&
        settingsLink?.parentElement === userButton?.parentElement,
      'Expected settings, theme, and user controls to share the bottom control stack.',
    )

    const bottomControls = Array.from(themeButton?.parentElement?.children ?? [])
    assertElement(
      bottomControls.indexOf(userButton!) < bottomControls.indexOf(settingsLink!) &&
        bottomControls.indexOf(settingsLink!) < bottomControls.indexOf(themeButton!),
      'Expected Settings to appear between the user avatar and theme toggle.',
    )

    const getThemeIconClassName = () =>
      ownerDocument.querySelector('[aria-label="Toggle theme"] svg')?.getAttribute('class') ?? ''

    const initialThemeIconClassName = getThemeIconClassName()

    await userEvent.click(themeButton!)
    await waitForCondition(() => getThemeIconClassName() !== initialThemeIconClassName)

    await userEvent.click(themeButton!)
    await waitForCondition(() => getThemeIconClassName() === initialThemeIconClassName)

    await userEvent.click(notificationButton!)
    await waitForCondition(() => Boolean(ownerDocument.querySelector('[role="dialog"]')))

    await userEvent.keyboard('{Escape}')
    await waitForCondition(() => !ownerDocument.querySelector('[role="dialog"]'))

    await userEvent.click(userButton!)
    await waitForCondition(() => Boolean(ownerDocument.querySelector('[role="menu"]')))

    await userEvent.keyboard('{Escape}')
    await waitForCondition(() => !ownerDocument.querySelector('[role="menu"]'))
  },
}

export const ProjectsActive: Story = {
  render: () => <InteractiveSidebarStory pathname="/projects" initialTheme="light" />,
  play: async ({ canvasElement, userEvent }) => {
    const ownerDocument = canvasElement.ownerDocument
    await waitForCondition(() => Boolean(ownerDocument.querySelector('[aria-label="Projects"]')))

    const projectsLink = ownerDocument.querySelector('[aria-label="Projects"]') as HTMLElement | null
    if (!projectsLink) {
      throw new Error('Expected the Projects icon link to render.')
    }

    assertElement(projectsLink.getAttribute('aria-current') === 'page', 'Expected Projects to be the active route.')

    await userEvent.hover(projectsLink)
    await waitForCondition(() => {
      const tooltip = ownerDocument.querySelector('[role="tooltip"]')
      return Boolean(tooltip?.textContent?.includes('Projects'))
    })
  },
}

export const SettingsActive: Story = {
  render: () => <InteractiveSidebarStory pathname="/settings/connections" initialTheme="light" />,
  play: async () => {
    const ownerDocument = document
    await waitForCondition(() => Boolean(ownerDocument.querySelector('[aria-label="Settings"]')))

    const settingsLink = ownerDocument.querySelector('[aria-label="Settings"]') as HTMLElement | null
    if (!settingsLink) {
      throw new Error('Expected the Settings icon link to render.')
    }

    assertElement(settingsLink.getAttribute('aria-current') === 'page', 'Expected Settings to be the active route.')
  },
}

export const UserProfileClicked: Story = {
  render: () => <InteractiveSidebarStory pathname="/issues/42" initialTheme="dark" initialUserMenuOpen={true} />,
  play: async ({ canvasElement }) => {
    const ownerDocument = canvasElement.ownerDocument
    await waitForCondition(() => Boolean(ownerDocument.querySelector('[role="menu"]')))

    const menu = ownerDocument.querySelector('[role="menu"]')
    assertElement(menu, 'Expected the account dropdown menu to be visible.')
    assertElement(menu?.textContent?.includes('Sign Out'), 'Expected the account menu to include Sign Out.')
  },
}
