import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
  /** Where tapping the toast goes (e.g. the game a notification is about). */
  href?: string
}

interface ToastState {
  toasts: Toast[]
  push(kind: Toast['kind'], message: string, href?: string): void
  dismiss(id: number): void
}

let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(kind, message, href) {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, kind, message, href }] })
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3500)
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))

export const toast = {
  success: (message: string) => useToasts.getState().push('success', message),
  error: (err: unknown) => useToasts.getState().push('error', err instanceof Error ? err.message : String(err)),
  info: (message: string, href?: string) => useToasts.getState().push('info', message, href),
}
