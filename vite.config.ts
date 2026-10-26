import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { securityHeaders } from './deploy/security-headers.ts'

// A plain ws:// dev relay (VITE_RELAYS) and its fake block-height endpoint must be allowed by the preview's CSP.
const localRelays = (process.env.VITE_RELAYS ?? '').split(',').filter((r) => r.startsWith('ws://'))
const localOrigins = [...localRelays, ...localRelays.map((r) => r.replace(/^ws:/, 'http:'))]
// …and so must a push service running locally (VITE_PUSH_URL) during testing.
if (process.env.VITE_PUSH_URL?.startsWith('http://localhost')) localOrigins.push(new URL(process.env.VITE_PUSH_URL).origin)

export default defineConfig({
  // `vite preview` serves the production build with production security headers.
  // Sprite sheets uploaded to the dev relay's pretend Blossom server are http:// images.
  preview: { headers: securityHeaders(localOrigins, localOrigins.filter((o) => o.startsWith('http:'))) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Our own service worker (src/sw.ts): offline app shell plus push notifications.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icons/favicon-64.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Silvamor',
        short_name: 'Silvamor',
        description: 'Play games on Nostr with friends. No accounts, no app stores.',
        theme_color: '#1e1442',
        background_color: '#1e1442',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
})
