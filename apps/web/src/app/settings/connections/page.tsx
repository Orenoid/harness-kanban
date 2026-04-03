import { NextPage } from 'next'

import { SettingsConnectionsPage } from '@/settings/pages/connections-page'
import { RedirectToSignIn, SignedIn, SignedOut } from '@daveyplate/better-auth-ui'

const SettingsConnectionsRoute: NextPage = () => {
  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>

      <SignedIn>
        <SettingsConnectionsPage />
      </SignedIn>
    </>
  )
}

export default SettingsConnectionsRoute
