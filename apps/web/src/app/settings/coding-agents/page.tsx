import { NextPage } from 'next'

import { SettingsCodingAgentsPage } from '@/settings/pages/coding-agents-page'
import { RedirectToSignIn, SignedIn, SignedOut } from '@daveyplate/better-auth-ui'

const SettingsCodingAgentsRoute: NextPage = () => {
  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>

      <SignedIn>
        <SettingsCodingAgentsPage />
      </SignedIn>
    </>
  )
}

export default SettingsCodingAgentsRoute
