'use client'

import React from 'react'

import { CodingAgentSettingsSection } from '@/settings/components/coding-agent-settings-section'
import { SettingsShell } from '@/settings/components/settings-shell'

export const SettingsCodingAgentsPage: React.FC = () => {
  return (
    <SettingsShell currentPath="/settings/coding-agents">
      <CodingAgentSettingsSection />
    </SettingsShell>
  )
}
