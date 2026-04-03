'use client'

import { ChevronsUpDown, CircleUserRoundIcon, LogInIcon, LogOutIcon, SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useEffect, useState } from 'react'

import { GeometricUserAvatar } from '@/components/common/geometric-user-avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/shadcn/utils'
import { useAuthClient } from '@/providers/auth-client-provider'

export interface UserButtonCustomClassNames {
  base?: string
  skeleton?: string
  trigger?: {
    base?: string
    avatar?: string
    user?: string
    skeleton?: string
  }
  content?: {
    base?: string
    user?: string
    avatar?: string
    menuItem?: string
    separator?: string
  }
}

interface UserButtonCustomProps {
  className?: string
  classNames?: UserButtonCustomClassNames
  size?: 'icon' | 'default'
  align?: 'center' | 'start' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface UserButtonCustomViewProps extends UserButtonCustomProps {
  user: {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
  } | null
  mounted: boolean
  isPending: boolean
  signOutPending: boolean
  onSignOut: () => Promise<void>
}

export function UserButtonCustomView({
  className,
  classNames,
  size = 'icon',
  align = 'end',
  side = 'bottom',
  open,
  onOpenChange,
  user,
  mounted,
  isPending,
  signOutPending,
  onSignOut,
}: UserButtonCustomViewProps) {
  const displayName = user?.name || user?.email || 'User'
  const profile = user
    ? {
        id: user.id,
        username: displayName,
        imageUrl: user.image || null,
      }
    : null

  if (!mounted) {
    if (size === 'icon') {
      return (
        <Button size="icon" className={cn('size-fit rounded-full', classNames?.trigger?.base)} variant="ghost">
          <CircleUserRoundIcon className="h-4 w-4" />
        </Button>
      )
    }

    return <Skeleton className={cn('size-8 shrink-0 rounded-full', classNames?.skeleton)} />
  }

  if (!user) {
    if (size === 'icon') {
      return (
        <Button asChild size="icon" className={cn('size-fit rounded-full', classNames?.trigger?.base)} variant="ghost">
          <Link href="/auth/sign-in" aria-label="Sign In">
            <LogInIcon className="h-4 w-4" />
          </Link>
        </Button>
      )
    }

    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Link href="/auth/sign-in" className="hover:text-primary text-sm">
          Sign In
        </Link>
        <Link href="/auth/sign-up" className="hover:text-primary text-sm">
          Sign Up
        </Link>
      </div>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild className={cn(size === 'icon' && 'rounded-full', classNames?.trigger?.base)}>
        {size === 'icon' ? (
          <Button size="icon" className="size-fit rounded-full" variant="ghost">
            {isPending ? (
              <Skeleton className={cn('size-8 shrink-0 rounded-full', classNames?.trigger?.skeleton)} />
            ) : (
              <GeometricUserAvatar
                user={profile}
                size={32}
                className={cn('h-8 w-8', className, classNames?.base, classNames?.trigger?.avatar)}
              />
            )}
          </Button>
        ) : (
          <Button className={cn('h-fit !p-2', className, classNames?.trigger?.base)} variant="ghost">
            <div className={cn('flex items-center gap-2', classNames?.trigger?.user)}>
              {isPending ? (
                <Skeleton className={cn('size-8 shrink-0 rounded-full', classNames?.trigger?.skeleton)} />
              ) : (
                <GeometricUserAvatar user={profile} size={32} className={cn('my-0.5', classNames?.trigger?.avatar)} />
              )}
              {!isPending && (
                <>
                  <div className="grid flex-1 text-start leading-tight">
                    <span className="truncate text-sm font-semibold">{displayName}</span>
                    {user.email && <span className="truncate text-xs opacity-70">{user.email}</span>}
                  </div>
                  <ChevronsUpDown className="ml-auto" />
                </>
              )}
            </div>
          </Button>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className={cn('w-[--radix-dropdown-menu-trigger-width] min-w-56 max-w-64', classNames?.content?.base)}
        align={align}
        side={side}
        onCloseAutoFocus={e => e.preventDefault()}>
        <div className={cn('p-2', classNames?.content?.menuItem)}>
          {isPending ? (
            <div className={cn('flex items-center gap-2', classNames?.content?.user)}>
              <Skeleton className={cn('size-10 shrink-0 rounded-full', classNames?.content?.avatar)} />
              <div className="grid flex-1 gap-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ) : (
            <div className={cn('flex items-center gap-2', classNames?.content?.user)}>
              <GeometricUserAvatar user={profile} size={40} className={cn('h-10 w-10', classNames?.content?.avatar)} />
              <div className="grid flex-1 text-start leading-tight">
                <span className="truncate text-sm font-semibold">{displayName}</span>
                {user.email && <span className="truncate text-xs opacity-70">{user.email}</span>}
              </div>
            </div>
          )}
        </div>

        <DropdownMenuSeparator className={classNames?.content?.separator} />

        <Link href="/settings/connections">
          <DropdownMenuItem className={classNames?.content?.menuItem}>
            <SettingsIcon className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
        </Link>

        <DropdownMenuItem
          className={classNames?.content?.menuItem}
          onClick={() => {
            void onSignOut()
          }}
          disabled={signOutPending}>
          <LogOutIcon className="mr-2 h-4 w-4" />
          {signOutPending ? 'Signing out...' : 'Sign Out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function UserButtonCustom({
  className,
  classNames,
  size = 'icon',
  align = 'end',
  side = 'bottom',
  open,
  onOpenChange,
}: UserButtonCustomProps) {
  const router = useRouter()
  const authClient = useAuthClient()
  const [signOutPending, setSignOutPending] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const { data: sessionData, isPending: sessionPending } = authClient.useSession()
  const user = sessionData?.user ?? null
  const isPending = sessionPending || signOutPending || !mounted

  const handleSignOut = async () => {
    setSignOutPending(true)
    try {
      await authClient.signOut()
      toast.success('Signed out successfully')
      router.push('/auth/sign-in')
    } catch {
      toast.error('Failed to sign out')
    } finally {
      setSignOutPending(false)
    }
  }

  return (
    <UserButtonCustomView
      className={className}
      classNames={classNames}
      size={size}
      align={align}
      side={side}
      open={open}
      onOpenChange={onOpenChange}
      user={user}
      mounted={mounted}
      isPending={isPending}
      signOutPending={signOutPending}
      onSignOut={handleSignOut}
    />
  )
}
