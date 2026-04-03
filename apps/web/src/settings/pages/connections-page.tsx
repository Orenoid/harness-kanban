'use client'

import React from 'react'

import { GithubConnectionSection } from '@/settings/components/github-connection-section'
import { SettingsShell } from '@/settings/components/settings-shell'

export const SettingsConnectionsPage: React.FC = () => {
  return (
    <SettingsShell currentPath="/settings/connections">
      <GithubConnectionSection />
    </SettingsShell>
  )
}
