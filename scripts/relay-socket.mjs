// The WebSocket for talking to relays from Node: the push service and `npm run stats` use it, with
// nostr-tools' useWebSocketImplementation.
//
// nostr-tools closes a socket from its error handler, and stops listening when it gives up on one.
// Node 22's own WebSocket answers that close with another error while it still counts as connecting,
// again and again, until the stack overflows and the process exits. `ws` doesn't, but when nostr-tools
// gives up on a connection that hasn't opened (a relay that takes it and never answers, or the pool
// closing), `ws` reports it a moment after nostr-tools stopped listening, and an error nobody listens
// for ends a Node process too. So: `ws`, always listening.
import WebSocket from 'ws'

export class RelaySocket extends WebSocket {
  constructor(address, protocols) {
    super(address, protocols)
    // nostr-tools still hears every error while it listens; this only keeps the late ones quiet.
    this.on('error', () => {})
  }
}
