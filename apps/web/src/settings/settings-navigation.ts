export const SETTINGS_NAV_ITEMS = [
  {
    href: '/settings/connections',
    label: 'Connections',
    description: 'Manage external services and credentials.',
  },
] as const

export const SETTINGS_DEFAULT_PATH = SETTINGS_NAV_ITEMS[0].href
