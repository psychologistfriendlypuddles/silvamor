import { Suspense, lazy, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { useSession } from './stores/session'
import { readRelays, useRelays } from './stores/relays'
import { useProfiles } from './stores/profiles'
import { useLobby } from './stores/lobby'
import { useHostAgent } from './hooks/useHostAgent'
import { useGameWatcher } from './hooks/useGameWatcher'
import { useBlocks } from './stores/blocks'
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
const LobbyPage = page(() => import('./pages/Lobby'), 'LobbyPage')
const GamePage = page(() => import('./pages/Game'), 'GamePage')
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

  // Once we know who the user is, pull their relay list and profile.
  const [relaysReady, setRelaysReady] = useState<string | null>(null)
  useEffect(() => {
    if (status !== 'signedIn' || !pubkey) return
    let cancelled = false
    useRelays
      .getState()
      .load(pubkey)
      .finally(() => {
        if (cancelled) return
        useProfiles.getState().fetch(pubkey, readRelays(useRelays.getState().relays), true)
        setRelaysReady(pubkey)
      })
    return () => {
      cancelled = true
    }
  }, [status, pubkey])

  // Follow the lobby on the user's relays, and start over whenever the saved relay list changes.
  const relayKey = useRelays((s) => s.published.map((r) => `${r.url}:${r.read}`).join(','))
  useEffect(() => {
    if (status !== 'signedIn' || !pubkey || relaysReady !== pubkey) return
    return useLobby.getState().start(pubkey)
  }, [status, pubkey, relaysReady, relayKey])

  useHostAgent()
  useGameWatcher()

  // Bitcoin block height is the turn clock; keep it fresh while signed in.
  useEffect(() => {
    if (status === 'signedIn') return useBlocks.getState().start()
  }, [status])

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
              <Route index element={<LobbyPage />} />
              <Route path="groups" element={<GroupsPage />} />
              <Route path="sprites" element={<SpriteShopPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="relays" element={<RelaysPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="game/:naddr" element={<GamePage />} />
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
