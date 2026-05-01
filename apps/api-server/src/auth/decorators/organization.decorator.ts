import { createParamDecorator } from '@nestjs/common'
import { DEFAULT_WORKSPACE_ID } from '@repo/shared'

export type AuthOrganizationOptions = Record<string, never>

export const AuthWorkspaceId = createParamDecorator((): string => {
  return DEFAULT_WORKSPACE_ID
})
