import type { KV, RequestBody } from '@shared/types'

export interface HttpBlockPatch {
  method?: string
  url?: string
  headers?: KV[]
  body?: RequestBody
}

/** Parse an AI-produced ```http block into a request patch.
 *  Format: "METHOD url" / header lines / blank line / body. */
export function parseHttpBlock(text: string): HttpBlockPatch {
  const lines = text.replace(/\r/g, '').split('\n')
  const patch: HttpBlockPatch = {}
  if (!lines.length) return patch

  const first = lines[0].trim()
  const m = first.match(/^([A-Z]+)\s+(.+)$/)
  let i = 1
  if (m) {
    patch.method = m[1]
    patch.url = m[2].trim()
  } else {
    // maybe just a URL on the first line
    if (/^https?:\/\//.test(first) || first.includes('{{')) patch.url = first
  }

  const headers: KV[] = []
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      break
    }
    const idx = line.indexOf(':')
    if (idx > 0) headers.push({ key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim(), enabled: true })
  }
  if (headers.length) patch.headers = headers

  const bodyText = lines.slice(i).join('\n').trim()
  if (bodyText) {
    const looksJson = /^[[{]/.test(bodyText)
    patch.body = { type: 'raw', language: looksJson ? 'json' : 'text', text: bodyText }
  }

  return patch
}
