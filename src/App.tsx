import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { useSession } from './stores/session'
import { readRelays, useRelays } from './stores/relays'
import { useProfiles } from './stores/profiles'
import { mirrorToHome } from './lib/nostr/mirror'
import { DISCOVERY_RELAYS } from './lib/nostr/pool'
import { useDailyWatcher } from './hooks/useDailyWatcher'
import { Background } from './components/Background'
import { Toaster } from './components/Toaster'
import { SignerWaiting } from './components/SignerWaiting'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'

// Each page is its own chunk, downloaded the first time it's opened.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })))
const LoginPage = page(() => import('./pages/Login'), 'LoginPage')
const UnlockPage = page(() => import('./pages/Unlock'), 'UnlockPage')
const DailyPage = page(() => import('./pages/Daily'), 'DailyPage')
const GroupsPage = page(() => import('./pages/Groups'), 'GroupsPage')
const ProfilePage = page(() => import('./pages/Profile'), 'ProfilePage')
const RelaysPage = page(() => import('./pages/Relays'), 'RelaysPage')
const NotificationsPage = page(() => import('./pages/Notifications'), 'NotificationsPage')
const SpriteShopPage = page(() => import('./pages/SpriteShop'), 'SpriteShopPage')
// The legal pages take a prop (standalone, before logging in), so they're lazy-loaded with their own types.
const TermsPage = lazy(() => import('./pages/Legal').then((m) => ({ default: m.TermsPage })))
const PrivacyPage = lazy(() => import('./pages/Legal').then((m) => ({ default: m.PrivacyPage })))

function FullScreenSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner className="size-12" />
    </div>
  )
}

export default function App() {
  const { status, pubkey, boot } = useSession()

  useEffect(() => {
    boot()
  }, [boot])

  // Once we know who the user is, pull their relay list and profile, and copy their profile,
  // follow list and relay list to the home relay.
  useEffect(() => {
    if (status !== 'signedIn' || !pubkey) return
    let cancelled = false
    useRelays
      .getState()
      .load(pubkey)
      .finally(() => {
        if (cancelled) return
        const relays = useRelays.getState().relays
        useProfiles.getState().fetch(pubkey, readRelays(relays), true)
        void mirrorToHome(pubkey, [...new Set([...DISCOVERY_RELAYS, ...relays.map((r) => r.url)])]).catch(() => {})
      })
    return () => {
      cancelled = true
    }
  }, [status, pubkey])

  useDailyWatcher()

  return (
    <BrowserRouter>
      <Background />
      <Toaster />
      <SignerWaiting />
      <Suspense fallback={<FullScreenSpinner />}>
        {status === 'booting' && <FullScreenSpinner />}
        {/* The terms and privacy policy can be read before logging in. */}
        {(status === 'signedOut' || status === 'locked') && (
          <Routes>
            <Route path="terms" element={<TermsPage standalone />} />
            <Route path="privacy" element={<PrivacyPage standalone />} />
            <Route path="*" element={status === 'signedOut' ? <LoginPage /> : <UnlockPage />} />
          </Routes>
        )}
        {status === 'signedIn' && (
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<DailyPage />} />
              <Route path="groups" element={<GroupsPage />} />
              <Route path="sprites" element={<SpriteShopPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="relays" element={<RelaysPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="terms" element={<TermsPage />} />
              <Route path="privacy" element={<PrivacyPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        )}
      </Suspense>
    </BrowserRouter>
  )
}
