import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import nostrLogo from '../assets/nostr-logo.png'

/** Where questions about the terms and privacy go: Silvamor's Nostr account. */
const CONTACT_NPUB = 'npub1un3zlt56grf2wuytv4gjfzheghytsjy50s92m6pygt67gsjnsspse8r6um'
const CONTACT_LINK = `nostr:${CONTACT_NPUB}`

/** "message us on Nostr", linking to Silvamor's account in the reader's Nostr app. */
function NostrContact({ children = 'message us on Nostr' }: { children?: ReactNode }) {
  return (
    <a href={CONTACT_LINK} title={CONTACT_NPUB} className="text-mint hover:underline">
      {children}
    </a>
  )
}
const EFFECTIVE = 'October 27, 2026'
const SITE = 'www.silvamor.com'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-display text-white">{title}</h2>
      {children}
    </section>
  )
}

function Shell({ title, children, standalone }: { title: string; children: ReactNode; standalone?: boolean }) {
  return (
    <article className={`mx-auto flex max-w-2xl flex-col gap-6 text-[15px] leading-relaxed text-white/75 ${standalone ? 'px-4 py-10' : ''}`}>
      {standalone && (
        <Link to="/" className="flex items-center gap-2 self-start text-sm font-semibold text-mint hover:underline">
          <ArrowLeft className="size-4" /> Back to Silvamor
        </Link>
      )}
      <header>
        <h1 className="text-3xl font-display text-white md:text-4xl">{title}</h1>
        <p className="mt-1 text-sm text-white/45">Effective {EFFECTIVE}</p>
      </header>
      {children}
      <p className="border-t border-white/10 pt-4 text-sm text-white/45">
        See also the{' '}
        {title === 'terms of use' ? (
          <Link to="/privacy" className="text-mint hover:underline">
            privacy policy
          </Link>
        ) : (
          <Link to="/terms" className="text-mint hover:underline">
            terms of use
          </Link>
        )}
        .
      </p>
      <p className="-mt-3 flex items-center gap-3 text-sm text-white/45">
        Questions?
        <a
          href={CONTACT_LINK}
          title={`Message Silvamor on Nostr: ${CONTACT_NPUB}`}
          aria-label="Message Silvamor on Nostr"
          className="opacity-80 transition-opacity hover:opacity-100"
        >
          <img src={nostrLogo} alt="Nostr" className="h-10 w-auto" />
        </a>
      </p>
    </article>
  )
}

const ul = 'flex list-disc flex-col gap-1.5 pl-5'

export function TermsPage({ standalone }: { standalone?: boolean }) {
  return (
    <Shell title="terms of use" standalone={standalone}>
      <p>
        These terms cover your use of Silvamor: the app at {SITE} and the software behind it (together, “Silvamor”), run by its operator (“we”, “us”).
        By using Silvamor you agree to them. If you don’t agree, please don’t use it.
      </p>

      <Section title="1. What Silvamor is (and isn’t)">
        <p>
          Silvamor is software for playing games over Nostr, an open, public network of independent relays. It shows Daily Deal runs, leaderboards and other
          events that people sign with their own keys and publish to relays. We don’t run a game server and we don’t hold accounts. We run one relay,
          relay.silvamor.com, which stores Silvamor’s events so leaderboards work, and we decide what it accepts and how long it keeps it (see the
          privacy policy). We don’t control other relays, other Nostr apps, or what people publish.
        </p>
        <ul className={ul}>
          <li>
            <b>Your keys are yours.</b> Your Nostr key is your identity. We never receive it, so we can’t recover it, reset it or undo anything signed
            with it. Keep it safe.
          </li>
          <li>
            <b>Events are public and permanent.</b> Daily Deal runs, profiles, sprites, reports and payment receipts are published to public relays
            and can be copied by anyone. Deleting from Silvamor or asking relays to delete may not remove every copy.
          </li>
          <li>
            <b>Beta software.</b> Silvamor is new and may have bugs. Runs can be lost to glitches, relays can be slow or offline, and each day’s deal
            depends on public Bitcoin block services.
          </li>
        </ul>
      </Section>

      <Section title="2. Who can use it">
        <p>
          You must be at least 18 years old (or the age of majority where you live, if higher) to use Silvamor. You’re responsible for making sure
          your use of Silvamor is legal where you are.
        </p>
      </Section>

      <Section title="3. No custody, no payment processing">
        <p>
          <b>We never hold, receive, send or control anyone’s money.</b> Silvamor has no balances, wallets or accounts. When you pay someone (
          a tip), your own Lightning wallet pays their Lightning address directly; the payment is between
          you, your wallet provider and theirs. We aren’t a party to it, don’t process it, can’t see inside it beyond the public zap receipt, and
          can’t reverse, refund or recover it. We charge no fees and take no share of any payment.
        </p>
        <p>
          <b>Tips are gifts.</b> You can tip a sprite artist, or another player from their profile. A tip is voluntary, isn’t tied to any score,
          buys nothing, and can’t be refunded.
        </p>
        <p>
          If you connect a wallet (Nostr Wallet Connect), the connection is stored only on your device and talks to your wallet directly. Give it a
          small budget. You’re responsible for anything it pays.
        </p>
      </Section>

      <Section title="4. No betting">
        <p>
          Silvamor doesn’t offer wagers or any way to bet on games, and it isn’t a gambling service. Don’t use it, including its tips, to arrange
          bets. Daily Deal scores and leaderboard places win nothing and aren’t prizes; don’t bet on them.
        </p>
      </Section>

      <Section title="5. Sprites">
        <ul className={ul}>
          <li>
            <b>Sprites are free.</b> Anyone can share a sprite and anyone can use one. Nothing is sold and there are no licences.
          </li>
          <li>
            <b>Tips are gifts.</b> You can tip an artist whose sprite you like. A tip is a voluntary gift paid straight from your wallet to theirs; it
            doesn’t buy anything and can’t be refunded.
          </li>
          <li>
            <b>Share only what you may share.</b> Only publish art you made or have permission to share. Like any picture on Nostr, anyone can see and
            copy it.
          </li>
          <li>
            <b>Something wrong?</b> Use Report or Hide artist in the sprite shop. If something shown in Silvamor bothers you or uses your work without
            permission, <NostrContact /> and we can stop showing it in our app. We don’t review sprites before they appear and can’t remove anything
            from relays or other apps.
          </li>
        </ul>
      </Section>

      <Section title="6. Rules for using Silvamor">
        <p>Don’t use Silvamor to:</p>
        <ul className={ul}>
          <li>break the law, or help anyone else break it (including gambling, fraud or money-laundering laws);</li>
          <li>harass, threaten or impersonate people, or post hateful, sexual, violent or illegal content;</li>
          <li>infringe copyrights, trademarks or other rights;</li>
          <li>cheat, exploit bugs, interfere with other players, or overload the site, relays or services Silvamor uses;</li>
          <li>
            publish more than one run a day, or use other keys, scripts or solvers to practise and publish only your best: leaderboards work on the
            honour system, and we may hide runs or players from Silvamor’s leaderboards if we believe they cheat;
          </li>
          <li>attack the software, or try to get at other people’s keys, wallets or data.</li>
        </ul>
        <p>We may block access to {SITE} or our services for anyone who breaks these rules.</p>
      </Section>

      <Section title="7. Other services">
        <p>
          Silvamor connects you to services run by others: Nostr relays, signer apps and browser extensions, Lightning wallets and providers, Blossom
          file servers, Bitcoin block services, and push notification services. They have their own terms and we aren’t responsible for them.
        </p>
      </Section>

      <Section title="8. Open source">
        <p>
          Silvamor’s source code is licensed under the GNU General Public License v3. That licence governs the code; these terms govern using {SITE}.
        </p>
      </Section>

      <Section title="9. No warranty">
        <p>
          SILVAMOR IS PROVIDED “AS IS” AND “AS AVAILABLE”, WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF
          MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. We don’t promise that it will be available, accurate, secure
          or free of errors, that runs, payments or notifications will reach anyone, or that scores and leaderboards are correct or complete.
        </p>
      </Section>

      <Section title="10. Limitation of liability">
        <p>
          TO THE FULLEST EXTENT THE LAW ALLOWS, WE ARE NOT LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR ANY
          LOSS OF FUNDS, BITCOIN, DATA, KEYS, PROFITS OR GOODWILL, ARISING FROM YOUR USE OF SILVAMOR, PAYMENTS BETWEEN USERS, OR OTHER USERS’ CONDUCT.
          OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED TO US $50.
        </p>
      </Section>

      <Section title="11. Indemnity">
        <p>
          You agree to defend and hold us harmless from claims, losses and costs (including reasonable legal fees) arising from your use of Silvamor,
          your content, payments you make or receive, or your breaking these terms or the law.
        </p>
      </Section>

      <Section title="12. Changes">
        <p>
          We may update these terms. The effective date at the top of this page shows the latest version; continuing to use Silvamor after a change means you accept it. If part
          of these terms can’t be enforced, the rest still applies.
        </p>
      </Section>
    </Shell>
  )
}

export function PrivacyPage({ standalone }: { standalone?: boolean }) {
  return (
    <Shell title="privacy policy" standalone={standalone}>
      <p>
        Silvamor is built so we learn as little as possible about you. There are no accounts, no analytics, no ads, no tracking cookies, and we never
        see your private key. Our relay, relay.silvamor.com, stores the public events Silvamor publishes, for a limited time (section 4). This policy explains what
          does get shared, and with whom.
      </p>

      <Section title="1. What’s public on Nostr">
        <p>
          Everything you publish through Silvamor is a signed Nostr event sent to public relays: your profile, follow list and relay list, your Daily Deal runs (every move
          and the score, so anyone can see how you played), groups, sprites and sprite choices, reports, featured picks, and zap receipts for tips. Anyone can read, copy and keep these, and
          they’re tied to your public key. Don’t publish anything you want kept private.
        </p>
      </Section>

      <Section title="2. What stays on your device">
        <p>Silvamor keeps a few things in your browser’s storage so it works the next time you open it:</p>
        <ul className={ul}>
          <li>your login: your public key, plus, if you chose to be remembered, your private key encrypted with your password (NIP-49);</li>
          <li>a device key used only to talk to your signer app;</li>
          <li>your relay list, notification history and settings, and a cached copy of your shop settings;</li>
          <li>your Daily Deal run in progress, and the Bitcoin block that seeded the day’s deal;</li>
          <li>if you connect one, your wallet connection (Nostr Wallet Connect).</li>
        </ul>
        <p>
          We never receive these. Logging out removes your login; the rest stays on the device until you clear your browser’s data for {SITE}. To
          remove a wallet connection, use Disconnect on your profile.
        </p>
        <p>
          Your shop settings (hidden artists, blur preference) are also saved to relays, encrypted so that only you can read them, so they follow you
          to other devices.
        </p>
      </Section>

      <Section title="3. Who your device talks to">
        <p>To work, Silvamor connects directly from your device to services that will see your IP address and the requests you make:</p>
        <ul className={ul}>
          <li>Nostr relays (the defaults and any you add);</li>
          <li>your signer app or browser extension, if you use one;</li>
          <li>Bitcoin block services (mempool.space and blockstream.info by default) for each day’s deal;</li>
          <li>Lightning address providers and wallets, when checking or making payments;</li>
          <li>Blossom file servers (blossom.primal.net by default), when you upload a picture or sprite, and image hosts when pictures are shown;</li>
          <li>websites in profiles, when checking a NIP-05 address.</li>
        </ul>
        <p>Each runs under its own privacy policy.</p>
      </Section>

      <Section title="4. What we receive">
        <ul className={ul}>
          <li>
            <b>The website.</b> Like any web server, the server for {SITE} may log technical details of requests (IP address, time, page, browser
            type). We use these only to run and protect the site, and keep them for a short time.
          </li>
          <li>
            <b>Push notifications (optional).</b> If you turn them on, the push service stores your public key, your browser’s push address, and which
            notices it has already sent you. To decide when to notify you, it reads public Daily Deal runs and follow lists. Your browser’s push
            provider (such as Google, Apple or Mozilla) delivers the notifications. Turning notifications off deletes your push address.
          </li>
          <li>
            <b>Our relay.</b> Silvamor always publishes your Daily Deal runs, profile, follow list, relay list, groups, sprites, sprite choices,
            reports and tip receipts to relay.silvamor.com, which we run, as well as to the relays you choose. We use them to show leaderboards and
            send notifications. Runs and tip receipts are deleted after <b>30 days</b>. Sprite reports are kept so moderation keeps working. Profiles,
            follow lists, relay lists, groups, sprites and settings are kept only in their latest version: a newer one replaces the old, and they’re
            deleted when you delete them or ask us to.
            The relay also records the IP address and time of each connection, which we keep for no more than <b>30 days</b>.
          </li>
        </ul>
        <p>We don’t sell or share personal information, and we don’t use it for advertising.</p>
      </Section>

      <Section title="5. Payments and tips">
        <p>
          Tips go straight from your wallet to the other person’s Lightning address. We aren’t
          involved and don’t see them, except for the public zap receipt the recipient’s provider publishes, which shows the payer, the recipient, the
          amount and what it was for.
        </p>
      </Section>

      <Section title="6. Your choices">
        <ul className={ul}>
          <li>Use a new Nostr key if you want a separate identity for Silvamor.</li>
          <li>
            Choose your own relays (Silvamor always uses relay.silvamor.com as well, so leaderboards work), signer, wallet, Blossom server and push
            service.
          </li>
          <li>
            Ask us to delete your events and connection records from relay.silvamor.com: <NostrContact>message us on Nostr</NostrContact> from your
            key. We can’t delete copies on other relays or in other apps.
          </li>
          <li>Turn push notifications off at any time on the Alerts page.</li>
          <li>
            Ask relays to delete your events (Silvamor sends deletion requests where it offers to delete something), though relays and others may keep
            copies.
          </li>
          <li>
            <NostrContact>Message us on Nostr</NostrContact> with any question about your information.
          </li>
        </ul>
      </Section>

      <Section title="7. Children">
        <p>Silvamor is for adults (18+). It isn’t directed at children, and we don’t knowingly collect information from children under 13.</p>
      </Section>

      <Section title="8. Changes">
        <p>We may update this policy; the effective date at the top of this page shows the latest version.</p>
      </Section>
    </Shell>
  )
}
