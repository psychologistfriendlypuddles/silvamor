import { NavLink } from 'react-router'
import { motion } from 'motion/react'
import ostrich from '../assets/ostrich.png'

export const APP_NAME = 'silvamor'
export const TAGLINE = 'play games on nostr'

// From the logo design (assets/): Fredoka Bold, lower case, the "reversed on dark"
// palette, with the tilts of the primary lockup.
const LETTER_STYLES = [
  { color: '#FF7BA6', rotate: -4, y: 2 },
  { color: '#B7A3FF', rotate: 0, y: -6 },
  { color: '#3DE0D0', rotate: 3, y: 2 },
  { color: '#FFD75E', rotate: -3, y: -6 },
]

export function Wordmark({ className = 'text-2xl', bounce = false }: { className?: string; bounce?: boolean }) {
  return (
    <span className={`inline-flex leading-none font-bold tracking-tight select-none ${className}`} aria-label={APP_NAME}>
      {[...APP_NAME].map((char, i) => {
        const s = LETTER_STYLES[i % LETTER_STYLES.length]
        // Offsets in the design are for 152px type; scale them with the font size.
        const y = `${s.y / 152}em`
        return (
          <motion.span
            key={i}
            aria-hidden
            className="inline-block"
            style={{ color: s.color }}
            initial={bounce ? { y: '-0.4em', opacity: 0 } : false}
            animate={{ y, opacity: 1, rotate: s.rotate }}
            whileHover={{ y: '-0.12em', rotate: -s.rotate, transition: { type: 'spring', stiffness: 600, damping: 12 } }}
            transition={{ type: 'spring', stiffness: 400, damping: 14, delay: bounce ? i * 0.05 : 0 }}
          >
            {char}
          </motion.span>
        )
      })}
    </span>
  )
}

/** The ostrich chess piece on its own, no background. Size it with a height class. */
export function LogoMark({ className = 'h-11' }: { className?: string }) {
  return (
    <motion.img
      src={ostrich}
      alt=""
      draggable={false}
      whileHover={{ rotate: [0, -8, 6, 0], scale: 1.06 }}
      transition={{ duration: 0.5 }}
      className={`w-auto shrink-0 drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)] ${className}`}
    />
  )
}

export function Logo() {
  return (
    <NavLink to="/" className="flex items-center gap-3" aria-label={`${APP_NAME} home`}>
      <LogoMark />
      <Wordmark className="text-[1.7rem]" />
    </NavLink>
  )
}
