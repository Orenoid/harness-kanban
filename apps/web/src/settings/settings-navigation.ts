export const SETTINGS_NAV_ITEMS = [
  {
    href: '/settings/connections',
    label: 'Connections',
    description: 'Manage external services and credentials.',
  },
  {
    href: '/settings/coding-agents',
    label: 'Coding Agents',
    description: 'Manage reusable coding agent configurations.',
  },
] as const

export const SETTINGS_DEFAULT_PATH = SETTINGS_NAV_ITEMS[0].href
