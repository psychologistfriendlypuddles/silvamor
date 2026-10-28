import { Suspense } from 'react'
import { NavLink, useLocation, useOutlet } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, LogOut, Pickaxe, Radio, Spade, Store, UserRound, UsersRound } from 'lucide-react'
import { useSession } from '../stores/session'
import { useLoadModeration } from '../stores/moderation'
import { GitHubLink, LegalLinks } from './LegalLinks'
import { CoffeeButton } from './Coffee'
import { useProfile } from '../stores/profiles'
import { Avatar } from './Avatar'
import { Logo } from './Brand'
import { Spinner } from './ui'
import { useUnreadCount } from '../stores/notifications'

const NAV = [
  { to: '/', label: 'Miner', full: 'Beat the Miner', icon: Pickaxe, color: 'text-lemon' },
  { to: '/daily-deal', label: 'Daily Deal', icon: Spade, color: 'text-bubblegum' },
  { to: '/sprites', label: 'Sprites', icon: Store, color: 'text-grape' },
  { to: '/groups', label: 'Groups', icon: UsersRound, color: 'text-tangerine' },
  { to: '/notifications', label: 'Alerts', full: 'Notifications', icon: Bell, color: 'text-bubblegum' },
  { to: '/relays', label: 'Relays', icon: Radio, color: 'text-mint' },
  // On phones the avatar in the header is the way to the profile, so no bottom tab.
  { to: '/profile', label: 'Profile', icon: UserRound, color: 'text-sky', desktopOnly: true },
]

export function Layout() {
  const location = useLocation()
  const outlet = useOutlet()
  const { pubkey, signer, logout } = useSession()
  useLoadModeration(signer, pubkey)
  const profile = useProfile(pubkey)

  return (
    <div className="flex min-h-dvh">
      {/* Desktop side rail */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-white/10 bg-night-950/60 p-4 backdrop-blur md:flex">
        <Logo />
        <nav className="mt-8 flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end className="relative">
              {({ isActive }) => (
                <span className={`relative z-10 flex items-center gap-3 rounded-2xl px-4 py-3 font-medium transition-colors ${isActive ? 'text-white' : 'text-white/55 hover:text-white'}`}>
                  {isActive && (
                    <motion.span layoutId="rail-active" className="absolute inset-0 -z-10 rounded-2xl bg-white/10" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
                  )}
                  <item.icon className={`size-5 ${isActive ? item.color : ''}`} />
                  {item.full ?? item.label}
                  {item.to === '/notifications' && <UnreadBadge />}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto mb-3 flex flex-col items-start gap-3">
          <CoffeeButton />
          <LegalLinks className="px-3" />
        </div>
        <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3">
          {pubkey && <Avatar pubkey={pubkey} />}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{profile?.display_name || profile?.name || 'Anonymous'}</span>
          <button onClick={() => logout()} className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white" title="Log out">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-night-950/70 px-4 py-3 backdrop-blur md:hidden">
          <Logo />
          <span className="flex items-center gap-4">
            <CoffeeButton compact />
            <GitHubLink className="block size-6 text-white/40 transition-colors hover:text-white" />
            <NavLink to="/profile" aria-label="Your profile">
              {pubkey && <Avatar pubkey={pubkey} className="size-9" />}
            </NavLink>
          </span>
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-6 pb-28 md:px-8 md:pt-10 md:pb-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {/* Pages load on first visit; keep the navigation on screen meanwhile. */}
              <Suspense
                fallback={
                  <div className="flex justify-center py-20">
                    <Spinner />
                  </div>
                }
              >
                {outlet}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-white/10 bg-night-950/85 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        {NAV.filter((item) => !item.desktopOnly).map((item) => (
          <NavLink key={item.to} to={item.to} end>
            {({ isActive }) => (
              <span className={`relative flex flex-col items-center gap-1 rounded-2xl py-2 text-xs font-medium ${isActive ? 'text-white' : 'text-white/50'}`}>
                {isActive && (
                  <motion.span layoutId="tab-active" className="absolute inset-0 rounded-2xl bg-white/10" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
                )}
                <motion.span className="relative" animate={isActive ? { y: [0, -4, 0] } : {}} transition={{ duration: 0.3 }}>
                  <item.icon className={`relative size-6 ${isActive ? item.color : ''}`} />
                  {item.to === '/notifications' && <UnreadBadge floating />}
                </motion.span>
                <span className="relative">{item.label}</span>
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

/** Number of unread notifications, on the Alerts tab / sidebar item. */
function UnreadBadge({ floating }: { floating?: boolean }) {
  const count = useUnreadCount()
  if (count === 0) return null
  return (
    <span
      aria-label={`${count} unread`}
      className={`flex h-5 min-w-5 items-center justify-center rounded-full bg-bubblegum px-1.5 text-[11px] font-bold text-white ${
        floating ? 'absolute -top-1.5 -right-2.5' : 'ml-auto'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
