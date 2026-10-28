/**
 * Where a link that has to stay inside the app at `origin` goes: `url` (absolute, or relative to the
 * app) if it's in the app, else the app's start page. Push notifications carry their link from the
 * push service, which mustn't be able to send a player anywhere else.
 */
export function inApp(url: string | undefined, origin: string): string {
  try {
    const target = new URL(url ?? '/', origin)
    if (target.origin === origin) return target.href
  } catch {
    // Not an address at all.
  }
  return new URL('/', origin).href
}
