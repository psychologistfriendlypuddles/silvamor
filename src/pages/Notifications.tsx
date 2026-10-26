import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { BellRing, CheckCheck } from 'lucide-react'
import { useNotifications, type StoredNotice } from '../stores/notifications'
import { noticeText } from '../lib/noticeText'
import { gamePath } from '../lib/paths'
import { timeAgo, useDisplayName } from '../hooks/useDisplayName'
import { Avatar } from '../components/Avatar'
import { Button, Card, PageTitle } from '../components/ui'
import { PushCard } from '../components/PushCard'

export function NotificationsPage() {
  const { items, markAllRead } = useNotifications()
  const unread = items.some((n) => !n.read)

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle emoji="🔔" title="Notifications" subtitle="Your turn, new challengers, chat and finished games." />
        {unread && (
          <Button variant="secondary" icon={<CheckCheck className="size-4" />} onClick={markAllRead}>
            Mark all read
          </Button>
        )}
      </div>

      <PushCard />

      {items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-14 text-center">
          <motion.div animate={{ rotate: [0, 18, -14, 10, -6, 0] }} transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 2 }}>
            <BellRing className="size-12 text-bubblegum/60" />
          </motion.div>
          <p className="font-medium text-white/70">All quiet for now</p>
          <p className="max-w-xs text-sm text-white/45">Moves, invites, chat and strikes in your games will show up here while the app is open.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {items.map((n) => (
              <NoticeRow key={n.id} notice={n} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

function NoticeRow({ notice }: { notice: StoredNotice }) {
  const navigate = useNavigate()
  const markRead = useNotifications((s) => s.markRead)
  const name = useDisplayName(notice.actor ?? '0'.repeat(64))
  const { emoji, text } = noticeText(notice, notice.actor ? name : 'Someone', notice.title)
  const [, host, id] = notice.coordinate.split(':')

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      onClick={() => {
        markRead(notice.id)
        navigate(gamePath(host, id))
      }}
      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
        notice.read ? 'border-white/5 bg-night-900/50 text-white/60' : 'border-grape/40 bg-grape/10 text-white'
      }`}
    >
      <span className="relative shrink-0">
        {notice.actor ? <Avatar pubkey={notice.actor} className="size-10 text-sm" /> : <span className="flex size-10 items-center justify-center text-2xl">{emoji}</span>}
        {notice.actor && <span className="absolute -right-1 -bottom-1 text-base">{emoji}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm break-words">{text}</span>
        <span className="text-xs text-white/40">{timeAgo(notice.at)}</span>
      </span>
      {!notice.read && <span className="size-2.5 shrink-0 rounded-full bg-bubblegum" aria-label="Unread" />}
    </motion.button>
  )
}
