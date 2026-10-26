import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { MessageCircle, Send } from 'lucide-react'
import { MAX_CHAT_LENGTH, type ChatMessage } from '../lib/nostr/chat'
import { useDisplayName } from '../hooks/useDisplayName'
import { toast } from '../stores/toast'
import { Card } from './ui'

/** Table talk between the players. Spectators don't get this panel. */
export function GameChat({ messages, me, onSend }: { messages: ChatMessage[]; me: string; onSend(text: string): Promise<void> }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const list = useRef<HTMLDivElement>(null)

  // Keep the newest message in view.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await onSend(text)
      setText('')
    } catch (err) {
      toast.error(err)
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
      <h2 className="font-display flex items-center gap-2 text-lg">
        <MessageCircle className="size-5 text-mint" /> table talk
      </h2>
      <div ref={list} className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1" aria-label="Chat messages">
        {messages.length === 0 && <p className="py-3 text-center text-sm text-white/40">Say hi to your opponent 👋</p>}
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <Bubble key={m.id} message={m} mine={m.author === me} />
          ))}
        </AnimatePresence>
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Message your opponent…"
          aria-label="Chat message"
          className="min-w-0 flex-1 rounded-2xl border-2 border-white/10 bg-night-950/60 px-4 py-2.5 text-white placeholder-white/30 outline-none focus:border-grape"
        />
        <motion.button
          whileTap={{ scale: 0.9 }}
          type="submit"
          disabled={!text.trim() || sending}
          aria-label="Send"
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-grape to-bubblegum disabled:opacity-40"
        >
          <Send className="size-5" />
        </motion.button>
      </form>
    </Card>
  )
}

function Bubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const name = useDisplayName(message.author)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={`flex max-w-[85%] flex-col ${mine ? 'self-end items-end' : 'self-start items-start'}`}
    >
      {!mine && <span className="mb-0.5 px-1 text-[11px] text-white/45">{name}</span>}
      <span
        className={`rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap ${
          mine ? 'rounded-br-md bg-grape text-white' : 'rounded-bl-md bg-night-700 text-white'
        }`}
      >
        {message.text}
      </span>
    </motion.div>
  )
}
