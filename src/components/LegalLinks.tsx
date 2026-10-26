import { Link } from 'react-router'
import nostrLogo from '../assets/nostr-logo.png'

const link = 'font-medium text-white/60 underline-offset-2 hover:text-white hover:underline'

/** "By logging in you agree…": shown under the login options. */
export function LegalNote({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-xs leading-relaxed text-white/45 ${className}`}>
      By logging in you confirm you’re 18 or older and agree to the{' '}
      <Link to="/terms" className={link}>
        terms of use
      </Link>{' '}
      and{' '}
      <Link to="/privacy" className={link}>
        privacy policy
      </Link>
      .
    </p>
  )
}

const SOURCE_URL = 'https://github.com/psychologistfriendlypuddles/silvamor'
const AUTHOR_URL = 'https://primal.net/p/nprofile1qqswfc3046dyp548wz9k25fy3tu5tj9cfz28cz4daqjy9a0ygffcgqcz4sfd8'

const icon = 'block size-5 text-white/40 transition-colors hover:text-white'

/** The GitHub mark (octicons, MIT), drawn in the text colour. */
function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className="size-full">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

/** The Nostr ostrich, used as a mask so it takes the text colour like the GitHub mark. */
function NostrIcon() {
  return (
    <span
      aria-hidden
      className="block size-full bg-current"
      style={{ maskImage: `url(${nostrLogo})`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }}
    />
  )
}

/** The source code on GitHub, as an icon (also in the phone header). */
export function GitHubLink({ className = icon }: { className?: string }) {
  return (
    <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" aria-label="Source code on GitHub" title="Source code on GitHub" className={className}>
      <GitHubIcon />
    </a>
  )
}

/** Source code and author icons, then terms / privacy, on one line: for the sidebar and the profile page. */
export function LegalLinks({ className = '', center = false }: { className?: string; center?: boolean }) {
  return (
    <p className={`flex items-center gap-3 text-xs text-white/40 ${center ? 'justify-center' : ''} ${className}`}>
      <GitHubLink />
      <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" aria-label="The author on Nostr" title="The author on Nostr" className={icon}>
        <NostrIcon />
      </a>
      <Link to="/terms" className={link}>
        Terms
      </Link>
      <Link to="/privacy" className={link}>
        Privacy
      </Link>
    </p>
  )
}
