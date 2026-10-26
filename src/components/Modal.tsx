import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

/** Bottom sheet on phones, centered dialog on bigger screens. */
export function Modal({ open, onClose, children }: { open: boolean; onClose(): void; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-end justify-center bg-night-950/70 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 80, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] border border-white/10 bg-night-900 p-6 shadow-2xl sm:rounded-[2rem]"
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
