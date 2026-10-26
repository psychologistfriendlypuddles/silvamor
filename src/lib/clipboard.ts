/**
 * Copies text, also where navigator.clipboard is missing: browsers withhold it on
 * plain-http addresses, such as a phone opening the dev server over the network.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      return await navigator.clipboard.writeText(text)
    } catch {
      /* fall through to the old way */
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error("Couldn't copy. Select the text and copy it by hand.")
}
