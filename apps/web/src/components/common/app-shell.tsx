'use client'

import { FolderIcon, MoonIcon, SettingsIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { PropsWithChildren, useEffect, useState } from 'react'

import { AuthenticatedSideChat } from '@/agent/components'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/shadcn/utils'
import { NotificationBell } from '@/notification/components/notification-bell'
import { UserButtonCustom } from './user-button-custom'

const APP_NAV_ITEMS = [
  {
    href: '/projects',
    label: 'Projects',
    icon: FolderIcon,
    matches: (pathname: string) => pathname === '/projects' || pathname.startsWith('/projects/'),
  },
]

const SETTINGS_NAV_ITEM = {
  href: '/settings/connections',
  label: 'Settings',
  icon: SettingsIcon,
  matches: (pathname: string) => pathname === '/settings' || pathname.startsWith('/settings/'),
}

interface AppShellFrameProps extends PropsWithChildren {
  sidebar?: React.ReactNode
}

interface AppSidebarViewProps {
  pathname: string
  mounted: boolean
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  notificationControl?: React.ReactNode
  userControl: React.ReactNode
}

export const AppShellFrame: React.FC<AppShellFrameProps> = ({ children, sidebar }) => {
  return (
    <div className="flex h-screen flex-1 overflow-hidden">
      {sidebar}
      <div className="flex min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-auto">{children}</div>
        <AuthenticatedSideChat />
      </div>
    </div>
  )
}

export const AppSidebarView: React.FC<AppSidebarViewProps> = ({
  pathname,
  mounted,
  theme,
  onToggleTheme,
  notificationControl,
  userControl,
}) => {
  return (
    <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border flex w-16 shrink-0 flex-col items-center justify-between border-r px-2 py-4">
      <div className="flex min-h-0 flex-col items-center gap-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/projects"
              aria-label="Harness Kanban"
              className="focus-visible:ring-sidebar-ring flex size-10 items-center justify-center rounded-xl outline-none transition hover:opacity-90 focus-visible:ring-2">
              <Image src="/logo.svg" alt="Harness Kanban" width={22} height={22} priority />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            Harness Kanban
          </TooltipContent>
        </Tooltip>

        <nav className="flex flex-col gap-2">
          {APP_NAV_ITEMS.map(item => {
            const active = item.matches(pathname)
            const Icon = item.icon

            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'focus-visible:ring-sidebar-ring flex size-10 items-center justify-center rounded-xl outline-none transition focus-visible:ring-2',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    )}>
                    <Icon className={cn('size-5 shrink-0', active && 'text-sidebar-primary')} />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </nav>
      </div>

      <div className="flex flex-col items-center gap-2">
        {notificationControl}
        {userControl}

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={SETTINGS_NAV_ITEM.href}
              aria-label={SETTINGS_NAV_ITEM.label}
              aria-current={SETTINGS_NAV_ITEM.matches(pathname) ? 'page' : undefined}
              className={cn(
                'focus-visible:ring-sidebar-ring flex size-10 items-center justify-center rounded-xl outline-none transition focus-visible:ring-2',
                SETTINGS_NAV_ITEM.matches(pathname)
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}>
              <SETTINGS_NAV_ITEM.icon
                className={cn('size-5 shrink-0', SETTINGS_NAV_ITEM.matches(pathname) && 'text-sidebar-primary')}
              />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {SETTINGS_NAV_ITEM.label}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground size-10 rounded-xl"
              onClick={onToggleTheme}>
              {mounted ? (
                theme === 'dark' ? (
                  <SunIcon className="size-5" />
                ) : (
                  <MoonIcon className="size-5" />
                )
              ) : (
                <div className="size-5" />
              )}
              <span className="sr-only">Toggle theme</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            Toggle theme
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  )
}

export const AppSidebar: React.FC = () => {
  const pathname = usePathname() ?? ''
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const toggleTheme = () => {
    if (!mounted) return
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <AppSidebarView
      pathname={pathname}
      mounted={mounted}
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      onToggleTheme={toggleTheme}
      notificationControl={<NotificationBell />}
      userControl={
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <UserButtonCustom
                size="icon"
                align="start"
                side="right"
                classNames={{
                  trigger: {
                    base: 'h-10 w-10 rounded-xl border border-transparent p-0 hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent',
                    avatar: 'rounded-xl',
                    skeleton: 'rounded-xl',
                  },
                  content: {
                    base: 'ml-2',
                  },
                }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            Account
          </TooltipContent>
        </Tooltip>
      }
    />
  )
}

export const AppShell: React.FC<PropsWithChildren> = ({ children }) => {
  const pathname = usePathname() ?? ''
  const showSidebar =
    pathname.startsWith('/issues') || pathname.startsWith('/projects') || pathname.startsWith('/settings')

  return <AppShellFrame sidebar={showSidebar ? <AppSidebar /> : undefined}>{children}</AppShellFrame>
}
