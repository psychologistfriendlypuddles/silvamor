import { describe, expect, it } from 'vitest'
import { chatter, factsOf, type RawTx } from './facts'

const hex = (s: string) => Buffer.from(s).toString('hex')
const tx = (over: Partial<RawTx> = {}): RawTx => ({
  vin: [{ prevout: { scriptpubkey_type: 'v0_p2wpkh' }, witness: [] }],
  vout: [{ value: 50_000, scriptpubkey_type: 'v0_p2wpkh' }, { value: 1_000, scriptpubkey_type: 'v0_p2wpkh' }],
  ...over,
})

describe('what the sprite says about a transaction', () => {
  it('reads a short OP_RETURN message, and names protocol data instead of printing it', () => {
    const message = factsOf(tx({ vout: [{ value: 0, scriptpubkey_type: 'op_return', scriptpubkey_asm: `OP_RETURN OP_PUSHBYTES_19 ${hex('gm from the mempool')}` }] }))
    expect(message.opReturn).toEqual({ bytes: 19, text: 'gm from the mempool' })
    expect(chatter(message, 1)).toBe('Its OP_RETURN says: “gm from the mempool”')
    const runes = factsOf(tx({ vout: [{ value: 0, scriptpubkey_type: 'op_return', scriptpubkey_asm: 'OP_RETURN OP_PUSHNUM_13 OP_PUSHBYTES_4 00c0a233' }] }))
    expect(chatter(runes, 1)).toBe('It carries a Runes message in its OP_RETURN.')
    const binary = factsOf(tx({ vout: [{ value: 0, scriptpubkey_type: 'op_return', scriptpubkey_asm: 'OP_RETURN OP_PUSHBYTES_4 76336200' }] }))
    expect(binary.opReturn).toEqual({ bytes: 4, text: undefined })
  })

  it('finds an inscription and its content type in the witness', () => {
    // A tapscript: <key> OP_CHECKSIG OP_FALSE OP_IF "ord" 1 <content type> …
    const envelope = `20${'ab'.repeat(32)}ac` + '0063036f7264' + '0101' + '09' + hex('image/png')
    const facts = factsOf(tx({ vin: [{ prevout: { scriptpubkey_type: 'v1_p2tr' }, witness: ['00', envelope] }] }))
    expect(facts).toMatchObject({ inscription: 'image/png', taproot: true })
    expect(chatter(facts, 1)).toBe('An inscription rides along: an image tucked in the witness!')
  })

  it('spots consolidations, batches, big amounts, and old addresses', () => {
    const many = (n: number) => Array.from({ length: n }, () => ({ prevout: { scriptpubkey_type: 'p2pkh' } }))
    expect(chatter(factsOf(tx({ vin: many(230), vout: [{ value: 1 }] })), 1)).toBe('A consolidation: 230 coins swept into 1.')
    expect(chatter(factsOf(tx({ vout: Array.from({ length: 18 }, () => ({ value: 1 })) })), 1)).toBe('A batch payout: 18 payments in one go.')
    expect(chatter(factsOf(tx({ vout: [{ value: 420_000_000 }] })), 1)).toBe('It moves 4.2 BTC!')
    expect(chatter(factsOf(tx({ vin: many(1) })), 1)).toBe('Old school: it spends from a legacy 1… address.')
  })

  it('points out a parent, and big or small fee rates', () => {
    expect(chatter(factsOf(tx()), 1, 3)).toBe('It spends from #3. Worth paying for the parent to get it?')
    expect(chatter(factsOf(tx()), 3.2)).toBe("It pays 3× today's middle fee rate!")
    expect(chatter(factsOf(tx()), 1)).toBe('1 in, 2 out, moving 51,000 sats.')
    expect(chatter(factsOf(tx({ vout: [{ value: 3_500_000 }, { value: 1 }] })), 1)).toBe('1 in, 2 out, moving 0.035 BTC.')
    expect(chatter(undefined, 1)).toBe('A transaction waiting for a block.')
  })
})
