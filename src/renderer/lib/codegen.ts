import type { Auth, KV, RequestBody, RequestModel } from '@shared/types'

export type CodeTarget = 'curl' | 'javascript' | 'python' | 'go' | 'node'

export const CODE_TARGETS: { id: CodeTarget; label: string; lang: string }[] = [
  { id: 'curl', label: 'cURL', lang: 'bash' },
  { id: 'javascript', label: 'JavaScript (fetch)', lang: 'javascript' },
  { id: 'python', label: 'Python (requests)', lang: 'python' },
  { id: 'node', label: 'Node (https)', lang: 'javascript' },
  { id: 'go', label: 'Go', lang: 'go' }
]

function effectiveUrl(req: RequestModel): string {
  const enabled = req.query.filter((q) => q.enabled && q.key)
  if (!enabled.length) return req.url
  const sep = req.url.includes('?') ? '&' : '?'
  return req.url + sep + enabled.map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`).join('&')
}

function effectiveHeaders(req: RequestModel): KV[] {
  const headers = req.headers.filter((h) => h.enabled && h.key).map((h) => ({ ...h }))
  applyAuthToHeaders(headers, req.auth)
  // content-type from raw language if not present
  if (req.body.type === 'raw' && !headers.some((h) => h.key.toLowerCase() === 'content-type')) {
    const ct = { json: 'application/json', xml: 'application/xml', html: 'text/html', javascript: 'application/javascript', text: 'text/plain' }[req.body.language]
    headers.push({ key: 'Content-Type', value: ct, enabled: true })
  }
  if (req.body.type === 'graphql' && !headers.some((h) => h.key.toLowerCase() === 'content-type')) {
    headers.push({ key: 'Content-Type', value: 'application/json', enabled: true })
  }
  return headers
}

function applyAuthToHeaders(headers: KV[], auth: Auth): void {
  switch (auth.type) {
    case 'bearer':
      headers.push({ key: 'Authorization', value: `Bearer ${auth.token}`, enabled: true })
      break
    case 'basic':
      headers.push({ key: 'Authorization', value: `Basic <base64(${auth.username}:••••)>`, enabled: true })
      break
    case 'apikey':
      if (auth.addTo === 'header') headers.push({ key: auth.key, value: auth.value, enabled: true })
      break
    case 'oauth2':
      if (auth.accessToken) headers.push({ key: 'Authorization', value: `Bearer ${auth.accessToken}`, enabled: true })
      break
  }
}

function bodyString(body: RequestBody): string | null {
  switch (body.type) {
    case 'raw':
      return body.text
    case 'graphql':
      return JSON.stringify({ query: body.query, variables: safeJson(body.variables) })
    case 'urlencoded':
      return body.items
        .filter((i) => i.enabled)
        .map((i) => `${encodeURIComponent(i.key)}=${encodeURIComponent(i.value)}`)
        .join('&')
    case 'formdata':
      return null // handled specially per language
    case 'binary':
      return null
    default:
      return null
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s || '{}')
  } catch {
    return {}
  }
}

/** POSIX-safe single-quoting so quotes/`$`/backticks in values can't break or inject. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/* ---------------- cURL ---------------- */
function genCurl(req: RequestModel): string {
  const lines: string[] = [`curl -X ${req.method} ${shQuote(effectiveUrl(req))}`]
  for (const h of effectiveHeaders(req)) lines.push(`  -H ${shQuote(`${h.key}: ${h.value}`)}`)
  if (req.body.type === 'formdata') {
    for (const f of req.body.items.filter((i) => i.enabled))
      lines.push(`  -F ${shQuote(`${f.key}=${f.type === 'file' ? '@' + (f.filePath ?? 'file') : f.value}`)}`)
  } else if (req.body.type === 'binary' && req.body.filePath) {
    lines.push(`  --data-binary ${shQuote('@' + req.body.filePath)}`)
  } else {
    const b = bodyString(req.body)
    if (b != null) lines.push(`  -d ${shQuote(b)}`)
  }
  return lines.join(' \\\n')
}

/* ---------------- JS fetch ---------------- */
function genJsFetch(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const headerObj = headers.length
    ? `{\n${headers.map((h) => `    ${JSON.stringify(h.key)}: ${JSON.stringify(h.value)}`).join(',\n')}\n  }`
    : '{}'
  let bodyLine = ''
  // Embed the body as a string literal — inlining raw text as code breaks on
  // {{vars}} / non-literal JSON.
  const b = bodyString(req.body)
  if (b != null) bodyLine = `  body: ${JSON.stringify(b)},\n`
  return `const res = await fetch(${JSON.stringify(effectiveUrl(req))}, {
  method: ${JSON.stringify(req.method)},
  headers: ${headerObj},
${bodyLine}});
const data = await res.json();
console.log(data);`
}

/* ---------------- Python requests ---------------- */
function genPython(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const headerDict = `{${headers.map((h) => `${JSON.stringify(h.key)}: ${JSON.stringify(h.value)}`).join(', ')}}`
  let dataArg = ''
  // Embed the body as a string literal — inlining raw text as code breaks on
  // {{vars}} / non-literal JSON.
  const b = bodyString(req.body)
  if (b != null) dataArg = `, data=${JSON.stringify(b)}`
  return `import requests

response = requests.request(${JSON.stringify(req.method)}, ${JSON.stringify(effectiveUrl(req))}, headers=${headerDict}${dataArg})
print(response.status_code)
print(response.json())`
}

/* ---------------- Node https ---------------- */
function genNode(req: RequestModel): string {
  return genJsFetch(req) // Node 18+ has global fetch; reuse
}

/* ---------------- Go ---------------- */
function genGo(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const b = bodyString(req.body)
  const bodyVar = b != null ? `strings.NewReader(${JSON.stringify(b)})` : 'nil'
  const headerLines = headers.map((h) => `\treq.Header.Set(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)})`).join('\n')
  // Only import "strings" when it's actually used, else `go build` fails.
  const imports = ['"fmt"', '"io"', '"net/http"', ...(b != null ? ['"strings"'] : [])]
  return `package main

import (
${imports.map((i) => `\t${i}`).join('\n')}
)

func main() {
\treq, _ := http.NewRequest(${JSON.stringify(req.method)}, ${JSON.stringify(effectiveUrl(req))}, ${bodyVar})
${headerLines}
\tres, err := http.DefaultClient.Do(req)
\tif err != nil { panic(err) }
\tdefer res.Body.Close()
\tbody, _ := io.ReadAll(res.Body)
\tfmt.Println(res.Status)
\tfmt.Println(string(body))
}`
}

export function generateCode(target: CodeTarget, req: RequestModel): string {
  switch (target) {
    case 'curl':
      return genCurl(req)
    case 'javascript':
      return genJsFetch(req)
    case 'python':
      return genPython(req)
    case 'node':
      return genNode(req)
    case 'go':
      return genGo(req)
  }
}
