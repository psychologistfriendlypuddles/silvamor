// Security headers for serving the built app. docs/DEPLOY.md shows the same values as
// nginx config (a unit test keeps the two in sync), and `vite preview` sends them too,
// so the end-to-end tests run under the production policy.

const CSP = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  // Animations set inline style attributes.
  'style-src': ["'self'", "'unsafe-inline'"],
  // Profile pictures and relay icons can live on any HTTPS host; QR codes are data: URLs.
  'img-src': ["'self'", 'https:', 'data:', 'blob:'],
  'font-src': ["'self'"],
  // Relays (wss:), NIP-05 / NIP-11 lookups and Blossom uploads (https:).
  'connect-src': ["'self'", 'https:', 'wss:'],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
}

/** `extraConnect` lets local testing reach a plain ws:// dev relay; `extraImg` load its http:// images. */
export function contentSecurityPolicy(extraConnect: string[] = [], extraImg: string[] = []): string {
  const extra: Record<string, string[]> = { 'connect-src': extraConnect, 'img-src': extraImg }
  return Object.entries(CSP)
    .map(([directive, values]) => [directive, ...values, ...(extra[directive] ?? [])].join(' '))
    .join('; ')
}

export function securityHeaders(extraConnect: string[] = [], extraImg: string[] = []): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(extraConnect, extraImg),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }
}
