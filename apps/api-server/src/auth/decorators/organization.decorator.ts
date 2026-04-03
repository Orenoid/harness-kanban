import { createParamDecorator } from '@nestjs/common'
import { DEFAULT_WORKSPACE_ID } from '@repo/shared'

export type AuthOrganizationOptions = Record<string, never>

export const AuthWorkspaceId = createParamDecorator(
  (data: AuthOrganizationOptions): typeof data extends undefined ? string : string | null => {
    return DEFAULT_WORKSPACE_ID
  },
)
