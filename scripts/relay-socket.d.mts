import WebSocket from 'ws'

/** `ws`, always listening for errors, so a relay that can't be reached never ends the process. */
export class RelaySocket extends WebSocket {}
