/**
 * cURL command parser → RequestModel. Pure (no Node/DOM). Used by data import
 * and by the renderer's "paste cURL" affordance.
 */
import type { HttpMethod, KV, RequestBody, RequestModel, Auth } from './types'
import { makeId } from './id'

/** Tokenize a shell-style command line, honoring quotes and `\` continuations. */
export function tokenizeCurl(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, ' ').trim()
  const tokens: string[] = []
  let i = 0
  const n = text.length
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++
    if (i >= n) break
    let token = ''
    while (i < n && !/\s/.test(text[i])) {
      const ch = text[i]
      if (ch === "'") {
        i++
        while (i < n && text[i] !== "'") token += text[i++]
        i++ // closing quote
      } else if (ch === '"') {
        i++
        while (i < n && text[i] !== '"') {
          if (text[i] === '\\' && i + 1 < n) {
            i++
            token += text[i++]
          } else {
            token += text[i++]
          }
        }
        i++ // closing quote
      } else if (ch === '\\' && i + 1 < n) {
        i++
        token += text[i++]
      } else {
        token += text[i++]
      }
    }
    tokens.push(token)
  }
  return tokens
}

function splitHeader(raw: string): KV | null {
  const idx = raw.indexOf(':')
  if (idx === -1) return null
  const key = raw.slice(0, idx).trim()
  const value = raw.slice(idx + 1).trim()
  if (!key) return null
  return { key, value, enabled: true }
}

/** decodeURIComponent that never throws on malformed `%` escapes. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export interface CurlParseResult {
  request: RequestModel
  warnings: string[]
}

export function parseCurl(input: string, name = 'Imported request'): CurlParseResult {
  const warnings: string[] = []
  const tokens = tokenizeCurl(input)
  if (tokens[0] === 'curl') tokens.shift()

  let url = ''
  let method: HttpMethod | '' = ''
  const headers: KV[] = []
  const dataParts: string[] = []
  const urlencodedParts: { key: string; value: string }[] = []
  const formParts: { key: string; value: string; isFile: boolean }[] = []
  let auth: Auth = { type: 'none' }
  let isGetForm = false
  const getQuery: KV[] = []
  let rawBodyMode: 'data' | 'urlencoded' | 'form' | null = null

  const next = (idx: number): string => tokens[idx + 1] ?? ''

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '-X' || t === '--request') {
      method = next(i) as HttpMethod
      i++
    } else if (t === '-H' || t === '--header') {
      const h = splitHeader(next(i))
      if (h) headers.push(h)
      i++
    } else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-ascii' || t === '--data-binary') {
      dataParts.push(next(i))
      rawBodyMode = rawBodyMode ?? 'data'
      i++
    } else if (t === '--data-urlencode') {
      const v = next(i)
      const eq = v.indexOf('=')
      if (eq >= 0) urlencodedParts.push({ key: v.slice(0, eq), value: v.slice(eq + 1) })
      else urlencodedParts.push({ key: '', value: v })
      rawBodyMode = 'urlencoded'
      i++
    } else if (t === '-F' || t === '--form') {
      const v = next(i)
      const eq = v.indexOf('=')
      const key = eq >= 0 ? v.slice(0, eq) : v
      const val = eq >= 0 ? v.slice(eq + 1) : ''
      const isFile = val.startsWith('@')
      formParts.push({ key, value: isFile ? val.slice(1) : val, isFile })
      rawBodyMode = 'form'
      i++
    } else if (t === '-u' || t === '--user') {
      const v = next(i)
      const ci = v.indexOf(':')
      auth = { type: 'basic', username: ci >= 0 ? v.slice(0, ci) : v, password: ci >= 0 ? v.slice(ci + 1) : '' }
      i++
    } else if (t === '-b' || t === '--cookie') {
      headers.push({ key: 'Cookie', value: next(i), enabled: true })
      i++
    } else if (t === '-A' || t === '--user-agent') {
      headers.push({ key: 'User-Agent', value: next(i), enabled: true })
      i++
    } else if (t === '-e' || t === '--referer') {
      headers.push({ key: 'Referer', value: next(i), enabled: true })
      i++
    } else if (t === '-G' || t === '--get') {
      isGetForm = true
    } else if (t === '--url') {
      url = next(i)
      i++
    } else if (t === '--compressed' || t === '-L' || t === '--location' || t === '-s' || t === '--silent' || t === '-k' || t === '--insecure' || t === '-i' || t === '--include') {
      // accepted, no-op for the request model
    } else if (t.startsWith('-')) {
      warnings.push(`Ignored unsupported flag: ${t}`)
    } else if (!url && /^https?:\/\//i.test(t)) {
      url = t
    } else if (!url) {
      url = t
    }
  }

  // Build body
  let body: RequestBody = { type: 'none' }
  if (rawBodyMode === 'form') {
    body = {
      type: 'formdata',
      items: formParts.map((f) => ({
        key: f.key,
        type: f.isFile ? 'file' : 'text',
        value: f.isFile ? '' : f.value,
        filePath: f.isFile ? f.value : undefined,
        enabled: true
      }))
    }
  } else if (rawBodyMode === 'urlencoded') {
    body = { type: 'urlencoded', items: urlencodedParts.map((p) => ({ key: p.key, value: p.value, enabled: true })) }
  } else if (rawBodyMode === 'data' && dataParts.length) {
    const joined = dataParts.join('&')
    const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
    if (ct.includes('x-www-form-urlencoded') || (/^[\w.%-]+=[^&]*(&[\w.%-]+=[^&]*)*$/.test(joined) && !ct.includes('json'))) {
      const items = joined.split('&').map((pair) => {
        const eq = pair.indexOf('=')
        return { key: eq >= 0 ? safeDecode(pair.slice(0, eq)) : pair, value: eq >= 0 ? safeDecode(pair.slice(eq + 1)) : '', enabled: true }
      })
      body = { type: 'urlencoded', items }
    } else {
      const looksJson = ct.includes('json') || /^[[{]/.test(joined.trim())
      body = { type: 'raw', language: looksJson ? 'json' : 'text', text: joined }
    }
  }

  // GET with --data/-d/--data-urlencode (`curl -G`): move the data into the query
  // string instead of dropping it.
  if (isGetForm && (dataParts.length || urlencodedParts.length)) {
    for (const part of dataParts) {
      for (const pair of part.split('&')) {
        if (!pair) continue
        const eq = pair.indexOf('=')
        getQuery.push({
          key: eq >= 0 ? safeDecode(pair.slice(0, eq)) : safeDecode(pair),
          value: eq >= 0 ? safeDecode(pair.slice(eq + 1)) : '',
          enabled: true
        })
      }
    }
    for (const p of urlencodedParts) getQuery.push({ key: p.key, value: p.value, enabled: true })
    body = { type: 'none' }
  }

  if (!method) method = body.type !== 'none' ? 'POST' : 'GET'

  // bearer detection from Authorization header
  const authHeader = headers.find((h) => h.key.toLowerCase() === 'authorization')
  if (authHeader && /^bearer\s+/i.test(authHeader.value) && auth.type === 'none') {
    auth = { type: 'bearer', token: authHeader.value.replace(/^bearer\s+/i, '') }
  }

  const id = makeId('req')
  const request: RequestModel = {
    id,
    name,
    method,
    url,
    query: getQuery,
    headers,
    pathVariables: [],
    body,
    auth
  }
  return { request, warnings }
}
