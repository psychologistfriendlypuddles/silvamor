import { useState, type ComponentProps, type ReactNode } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { Eye, EyeOff, LoaderCircle } from 'lucide-react'

const buttonStyles = {
  primary:
    'bg-gradient-to-r from-grape to-bubblegum text-white shadow-lg shadow-bubblegum/30 hover:shadow-bubblegum/50',
  secondary: 'bg-night-700 text-white hover:bg-night-600',
  ghost: 'bg-transparent text-white/80 hover:bg-white/10 hover:text-white',
  danger: 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25',
  lemon: 'bg-lemon text-night-900 shadow-lg shadow-lemon/25 hover:brightness-105',
}

type ButtonProps = HTMLMotionProps<'button'> & {
  variant?: keyof typeof buttonStyles
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', loading, icon, className = '', children, disabled, ...rest }: ButtonProps) {
  return (
    <motion.button
      whileHover={disabled || loading ? undefined : { scale: 1.03 }}
      whileTap={disabled || loading ? undefined : { scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 font-semibold transition-[background-color,box-shadow,color] disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-5 animate-spin" /> : icon}
      {children as ReactNode}
    </motion.button>
  )
}

export function Card({ className = '', children, ...rest }: HTMLMotionProps<'div'>) {
  return (
    <motion.div
      className={`rounded-3xl border border-white/10 bg-night-900/80 p-5 shadow-xl shadow-black/20 backdrop-blur ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

type FieldProps = ComponentProps<'input'> & { label: string; hint?: ReactNode; error?: string | null; trailing?: ReactNode }

export function Field({ label, hint, error, trailing, className = '', type, ...rest }: FieldProps) {
  const [reveal, setReveal] = useState(false)
  const isPassword = type === 'password'
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-white/70">{label}</span>
      <span className="relative flex items-center">
        <input
          type={isPassword && reveal ? 'text' : type}
          className={`w-full rounded-2xl border-2 bg-night-950/60 px-4 py-3 text-white placeholder-white/30 outline-none transition-colors focus:border-grape ${
            error ? 'border-rose-400/70' : 'border-white/10'
          } ${isPassword || trailing ? 'pr-12' : ''}`}
          {...rest}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute right-3 text-white/50 hover:text-white"
            aria-label={reveal ? 'Hide' : 'Show'}
          >
            {reveal ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        ) : (
          trailing && <span className="absolute right-3">{trailing}</span>
        )}
      </span>
      {error ? (
        <span className="mt-1.5 block text-sm text-rose-300">{error}</span>
      ) : (
        hint && <span className="mt-1.5 block text-xs text-white/45">{hint}</span>
      )}
    </label>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-mint' : 'bg-night-700'}`}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
          className={`absolute top-1 size-5 rounded-full bg-white shadow ${checked ? 'right-1' : 'left-1'}`}
        />
      </button>
      <span className="text-sm text-white/80">{label}</span>
    </label>
  )
}

export function Spinner({ className = 'size-8' }: { className?: string }) {
  return <LoaderCircle className={`animate-spin text-grape ${className}`} />
}

export function PageTitle({ title, subtitle, emoji }: { title: string; subtitle?: string; emoji?: string }) {
  return (
    <div className="mb-6">
      <h1 className="flex items-center gap-3 text-3xl font-display tracking-tight md:text-4xl">
        {emoji && (
          <motion.span initial={{ rotate: -20, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', delay: 0.1 }}>
            {emoji}
          </motion.span>
        )}
        {title}
      </h1>
      {subtitle && <p className="mt-1 text-white/60">{subtitle}</p>}
    </div>
  )
}
