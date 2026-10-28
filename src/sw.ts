/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { inApp } from './lib/inApp'

// The app's service worker: offline app shell (as before) plus push notifications
// from a Silvamor push service (push/).

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
// Single-page app: any page (e.g. /reminders) loads the cached app shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// New versions take over right away (the app registers with autoUpdate).
self.addEventListener('install', () => void self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
}

self.addEventListener('push', (event) => {
  let data: PushPayload
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { body: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Silvamor', {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-64.png',
      tag: data.tag, // a newer reminder for the same day replaces the older one
      data: { url: data.url ?? '/' },
    }),
  )
})

// Tapping a notification opens Silvamor: in an open Silvamor window if there is one. Only ever
// Silvamor, whatever link the push service sent.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = inApp((event.notification.data as { url?: string })?.url, self.location.origin)
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (open) {
        await open.focus()
        await open.navigate(url)
      } else {
        await self.clients.openWindow(url)
      }
    })(),
  )
})
