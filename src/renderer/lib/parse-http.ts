import type { KV, RequestBody } from '@shared/types'
import { splitUrl } from './url'

export interface HttpBlockPatch {
  method?: string
  url?: string
  query?: KV[]
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

  // Split any query string out of the URL so it doesn't get sent twice (the
  // model puts the full URL on the request line while query is tracked apart).
  if (patch.url) {
    const { base, query } = splitUrl(patch.url)
    patch.url = base
    if (query.length) patch.query = query
  }

  const headers: KV[] = []
  // RFC 7230 header-name token. A line whose pre-colon part isn't a valid name
  // (e.g. a JSON body line `{"a":1}` with no blank separator) starts the body.
  const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      break
    }
    const idx = line.indexOf(':')
    const name = idx > 0 ? line.slice(0, idx).trim() : ''
    if (idx > 0 && HEADER_NAME_RE.test(name)) {
      headers.push({ key: name, value: line.slice(idx + 1).trim(), enabled: true })
    } else {
      break // body begins here (no blank line preceded it)
    }
  }
  if (headers.length) patch.headers = headers

  const bodyText = lines.slice(i).join('\n').trim()
  if (bodyText) {
    const looksJson = /^[[{]/.test(bodyText)
    patch.body = { type: 'raw', language: looksJson ? 'json' : 'text', text: bodyText }
  }

  return patch
}
