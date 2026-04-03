import { redirect } from 'next/navigation'

import { SETTINGS_DEFAULT_PATH } from '@/settings/settings-navigation'

export default function SettingsIndexPage() {
  redirect(SETTINGS_DEFAULT_PATH)
}
