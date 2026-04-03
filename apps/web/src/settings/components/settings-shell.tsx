'use client'

import Link from 'next/link'
import React from 'react'

import { LayoutSlot } from '@/components/layout/layout-slot'
import { cn } from '@/lib/shadcn/utils'
import { SETTINGS_NAV_ITEMS } from '@/settings/settings-navigation'

interface SettingsShellProps {
  children: React.ReactNode
  currentPath: string
  description?: string
  title?: string
}

export const SettingsShell: React.FC<SettingsShellProps> = ({
  children,
  currentPath,
  description,
  title = 'Settings',
}) => {
  return (
    <LayoutSlot className="container mx-auto flex max-w-6xl flex-1 flex-col gap-6 px-2 py-6 md:px-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground max-w-3xl text-sm">{description}</p> : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 md:flex-row">
        <aside className="md:w-60 md:shrink-0">
          <nav className="grid gap-2">
            {SETTINGS_NAV_ITEMS.map(item => {
              const active = currentPath === item.href || currentPath.startsWith(`${item.href}/`)

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-left transition-colors',
                    active ? 'bg-accent border-foreground/15' : 'hover:bg-accent/40 border-border',
                  )}>
                  <div className="text-sm font-medium">{item.label}</div>
                  <p className="text-muted-foreground mt-1 text-xs">{item.description}</p>
                </Link>
              )
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </LayoutSlot>
  )
}
