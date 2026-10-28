// What the sprite can say about a transaction on offer: the most interesting thing about it, read
// from what the block sources list (inputs, outputs, OP_RETURN data, witness). For show only: the
// game itself uses just fees, sizes and parents.

/** A transaction's facts, as kept in the day's deal. */
export interface TxFacts {
  inputs: number
  outputs: number
  /** Sats sent to its outputs. */
  value: number
  /** What its OP_RETURN carries: readable text, a protocol it belongs to, or just its size. */
  opReturn?: { text?: string; protocol?: string; bytes: number }
  /** An ordinals inscription in its witness: its content type ("" if it doesn't say). */
  inscription?: string
  /** It spends from a legacy (1…) address. */
  legacy?: boolean
  /** It spends from a Taproot address. */
  taproot?: boolean
}

/** How Esplora lists a transaction's inputs and outputs (the parts read here). */
export interface RawTx {
  vin: { witness?: string[]; prevout?: { scriptpubkey_type?: string } | null }[]
  vout: { value?: number; scriptpubkey_type?: string; scriptpubkey_asm?: string }[]
}

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16))
const MAX_TEXT = 80

/** OP_RETURN data as text, if it reads as a short message (printable, mostly letters). */
function asText(data: Uint8Array): string | undefined {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return undefined
  }
  // Letters, digits, punctuation and spaces only; at least 4 letters, and mostly letters and spaces.
  if (!/^[\p{L}\p{N}\p{P}\p{Zs}\p{S}]+$/u.test(text)) return undefined
  const letters = (text.match(/\p{L}/gu) ?? []).length
  if (letters < 4 || (letters + (text.match(/\s/g) ?? []).length) / text.length < 0.7) return undefined
  const trimmed = text.trim()
  return trimmed.length > MAX_TEXT ? `${trimmed.slice(0, MAX_TEXT - 1)}…` : trimmed
}

/** Known protocols by how their OP_RETURN starts. */
function protocolOf(asm: string, data: Uint8Array): string | undefined {
  if (/^OP_RETURN OP_PUSHNUM_13\b/.test(asm)) return 'Runes'
  const head = new TextDecoder().decode(data.slice(0, 4))
  if (head === 'omni') return 'Omni'
  if (head.startsWith('X2') || head.startsWith('id')) return 'Stacks'
  return undefined
}

function readOpReturn(asm: string): TxFacts['opReturn'] {
  // "OP_RETURN OP_PUSHBYTES_5 68656c6c6f …": the data is the hex pushes.
  const data = hexToBytes(
    asm
      .split(' ')
      .filter((part) => /^[0-9a-f]+$/i.test(part) && part.length % 2 === 0)
      .join(''),
  )
  const protocol = protocolOf(asm, data)
  return { bytes: data.length, ...(protocol ? { protocol } : { text: asText(data) }) }
}

/**
 * An inscription's content type: the envelope OP_FALSE OP_IF "ord" in a witness item, then tag 1
 * (content type) and its value.
 */
function readInscription(witness: string[] | undefined): string | undefined {
  for (const item of witness ?? []) {
    const at = item.indexOf('0063036f7264')
    if (at < 0) continue
    const rest = item.slice(at + 12)
    const tag = rest.match(/^0101([0-9a-f]{2})/)
    if (!tag) return ''
    const length = parseInt(tag[1], 16)
    const type = new TextDecoder().decode(hexToBytes(rest.slice(6, 6 + length * 2)))
    return /^[\w.+-]+\/[\w.+-]+/.test(type) ? type.split(';')[0] : ''
  }
  return undefined
}

export function factsOf(tx: RawTx): TxFacts {
  const opReturn = tx.vout.find((o) => o.scriptpubkey_type === 'op_return')
  const inscription = tx.vin.map((v) => readInscription(v.witness)).find((t) => t !== undefined)
  const types = tx.vin.map((v) => v.prevout?.scriptpubkey_type)
  return {
    inputs: tx.vin.length,
    outputs: tx.vout.length,
    value: tx.vout.reduce((sum, o) => sum + (o.value ?? 0), 0),
    ...(opReturn && { opReturn: readOpReturn(opReturn.scriptpubkey_asm ?? '') }),
    ...(inscription !== undefined && { inscription }),
    ...(types.includes('p2pkh') && { legacy: true }),
    ...(types.includes('v1_p2tr') && { taproot: true }),
  }
}

const kindOf = (contentType: string) => {
  const [type, sub] = contentType.split('/')
  if (type === 'image') return 'an image'
  if (type === 'text') return sub === 'html' ? 'a web page' : 'some text'
  if (type === 'audio') return 'a sound'
  if (type === 'video') return 'a video'
  return contentType ? `a ${sub ?? type} file` : 'something'
}
/** "4.2 BTC", "0.035 BTC", or "52,000 sats" for small amounts. */
const btc = (sats: number) =>
  sats >= 1e6 ? `${(sats / 1e8).toLocaleString('en-US', { maximumSignificantDigits: 3 })} BTC` : `${sats.toLocaleString('en-US')} sats`

/**
 * The sprite's line about a transaction: its most interesting fact. `rateVsMiddle` is its fee rate
 * over today's middle rate; `parent` its parent's number in the stream, if it has one there.
 */
export function chatter(facts: TxFacts | undefined, rateVsMiddle: number, parent?: number): string {
  if (parent !== undefined) return `It spends from #${parent}. Worth paying for the parent to get it?`
  if (facts?.inscription !== undefined) return `An inscription rides along: ${kindOf(facts.inscription)} tucked in the witness!`
  if (facts?.opReturn?.text) return `Its OP_RETURN says: “${facts.opReturn.text}”`
  if (facts?.opReturn?.protocol) return `It carries a ${facts.opReturn.protocol} message in its OP_RETURN.`
  if (facts && facts.inputs >= 10) return `A consolidation: ${facts.inputs} coins swept into ${facts.outputs}.`
  if (facts && facts.outputs >= 10) return `A batch payout: ${facts.outputs} payments in one go.`
  if (facts && facts.value >= 1e8) return `It moves ${btc(facts.value)}!`
  if (rateVsMiddle >= 2.5) return `It pays ${Math.round(rateVsMiddle)}× today's middle fee rate!`
  if (rateVsMiddle <= 0.4) return 'A penny-pincher: well under today’s middle fee rate.'
  if (facts?.opReturn) return `It stamps ${facts.opReturn.bytes} bytes of data into an OP_RETURN.`
  if (facts?.legacy) return 'Old school: it spends from a legacy 1… address.'
  if (facts?.taproot) return 'A Taproot spend: Bitcoin’s newest kind of address.'
  if (facts) return `${facts.inputs} in, ${facts.outputs} out, moving ${btc(facts.value)}.`
  return 'A transaction waiting for a block.'
}
