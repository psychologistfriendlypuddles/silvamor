import { getToken } from 'nostr-tools/nip98'
import type { AppSigner } from './nostr/signers'

// Push notifications through a Silvamor push service (push/, a self-hostable watchtower).

/** VITE_PUSH_URL sets the default push service; players can pick their own. */
export const DEFAULT_PUSH_URL = ((import.meta.env.VITE_PUSH_URL as string | undefined) ?? '').replace(/\/$/, '')

export type PushSupport = 'ok' | 'insecure' | 'unsupported'

/** Push needs HTTPS (or localhost) and a browser with service workers and the Push API. */
export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return 'insecure'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

const serverKey = (pubkey: string) => `silvamor:push-server:${pubkey}`
const enabledKey = (pubkey: string) => `silvamor:push-enabled:${pubkey}`

export function savedPushServer(pubkey: string): string {
  try {
    return localStorage.getItem(serverKey(pubkey)) ?? DEFAULT_PUSH_URL
  } catch {
    return DEFAULT_PUSH_URL
  }
}

export function savePushServer(pubkey: string, url: string) {
  localStorage.setItem(serverKey(pubkey), url.trim().replace(/\/$/, ''))
}

/** Whether this account turned push on in this browser (and the subscription still exists). */
export async function isPushEnabled(pubkey: string): Promise<boolean> {
  if (pushSupport() !== 'ok' || localStorage.getItem(enabledKey(pubkey)) !== 'yes') return false
  const registration = await navigator.serviceWorker.getRegistration()
  return !!(await registration?.pushManager.getSubscription())
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

/** A request to the push service signed with the player's Nostr key (NIP-98): no accounts needed. */
async function signedRequest(url: string, method: 'POST' | 'DELETE', body: object, signer: AppSigner) {
  const authorization = await getToken(url, method, (e) => signer.signEvent(e), true, body)
  const res = await fetch(url, { method, headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok && res.status !== 404) {
    const message = ((await res.json().catch(() => ({}))) as { error?: string }).error
    throw new Error(message ?? `The push server answered ${res.status}.`)
  }
}

export async function enablePush(pubkey: string, server: string, signer: AppSigner) {
  if (!server) throw new Error('Choose a push server first.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your browser settings, then try again.')
  const registration = await navigator.serviceWorker.ready
  const keyRes = await fetch(`${server}/vapid-public-key`).catch(() => null)
  if (!keyRes?.ok) throw new Error("Couldn't reach the push server. Check its address.")
  const key = await keyRes.text()
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) }))
  await signedRequest(`${server}/subscriptions`, 'POST', { subscription: subscription.toJSON() }, signer)
  localStorage.setItem(enabledKey(pubkey), 'yes')
}

export async function disablePush(pubkey: string, server: string, signer: AppSigner) {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    if (server) await signedRequest(`${server}/subscriptions`, 'DELETE', { endpoint: subscription.endpoint }, signer).catch(() => {})
    await subscription.unsubscribe()
  }
  localStorage.removeItem(enabledKey(pubkey))
}
