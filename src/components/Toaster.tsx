import { AnimatePresence, motion } from 'motion/react'
import { CircleCheck, CircleX, Info } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useToasts } from '../stores/toast'

const styles = {
  success: { icon: CircleCheck, className: 'border-mint/40 text-mint' },
  error: { icon: CircleX, className: 'border-rose-400/40 text-rose-300' },
  info: { icon: Info, className: 'border-sky/40 text-sky' },
}

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  const navigate = useNavigate()
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {toasts.map((t) => {
          const { icon: Icon, className } = styles[t.kind]
          return (
            <motion.button
              key={t.id}
              layout
              initial={{ opacity: 0, y: -30, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              onClick={() => {
                dismiss(t.id)
                if (t.href) navigate(t.href)
              }}
              className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border bg-night-900/95 px-4 py-3 text-left shadow-2xl backdrop-blur ${className}`}
            >
              <Icon className="size-5 shrink-0" />
              <span className="text-sm text-white">{t.message}</span>
            </motion.button>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
