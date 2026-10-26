import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from 'nostr-tools/utils'
import type { AppSigner } from './nostr/signers'

// Blossom (BUD-01/02): content-addressed file storage authorized by a signed Nostr event.
export const DEFAULT_BLOSSOM_SERVER = import.meta.env.VITE_BLOSSOM_SERVER ?? 'https://blossom.primal.net'

// @noble/hashes instead of crypto.subtle, which plain-http addresses don't get.
const sha256Hex = (data: ArrayBuffer) => bytesToHex(sha256(new Uint8Array(data)))

export async function uploadToBlossom(file: File, signer: AppSigner, server = DEFAULT_BLOSSOM_SERVER) {
  return (await uploadBlob(file, signer, server)).url
}

/** Uploads a file; returns where it lives and its sha256. */
export async function uploadBlob(file: File, signer: AppSigner, server = DEFAULT_BLOSSOM_SERVER) {
  const body = await file.arrayBuffer()
  const hash = sha256Hex(body)
  const now = Math.floor(Date.now() / 1000)
  const auth = await signer.signEvent({
    kind: 24242,
    created_at: now,
    content: `Upload ${file.name}`,
    tags: [
      ['t', 'upload'],
      ['x', hash],
      ['expiration', String(now + 300)],
    ],
  })

  const res = await fetch(`${server.replace(/\/$/, '')}/upload`, {
    method: 'PUT',
    headers: {
      Authorization: `Nostr ${btoa(JSON.stringify(auth))}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body,
  })
  if (!res.ok) {
    const reason = res.headers.get('X-Reason') || (await res.text().catch(() => '')) || res.statusText
    throw new Error(`Upload failed (${res.status}): ${reason}`)
  }
  const descriptor = (await res.json()) as { url: string; sha256?: string }
  if (descriptor.sha256 && descriptor.sha256 !== hash) throw new Error('The upload server changed the file.')
  return { url: descriptor.url, sha256: hash }
}
