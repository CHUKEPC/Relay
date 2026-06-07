import type { Auth, KV, RequestBody, RequestModel } from '@shared/types'

export type CodeTarget =
  | 'curl'
  | 'javascript'
  | 'python'
  | 'go'
  | 'node'
  | 'java'
  | 'csharp'
  | 'php'
  | 'ruby'
  | 'swift'
  | 'kotlin'
  | 'rust'
  | 'powershell'
  | 'httpie'

export const CODE_TARGETS: { id: CodeTarget; label: string; lang: string }[] = [
  { id: 'curl', label: 'cURL', lang: 'bash' },
  { id: 'javascript', label: 'JavaScript (fetch)', lang: 'javascript' },
  { id: 'python', label: 'Python (requests)', lang: 'python' },
  { id: 'node', label: 'Node (https)', lang: 'javascript' },
  { id: 'go', label: 'Go', lang: 'go' },
  { id: 'java', label: 'Java (OkHttp)', lang: 'java' },
  { id: 'csharp', label: 'C# (HttpClient)', lang: 'csharp' },
  { id: 'php', label: 'PHP (cURL)', lang: 'php' },
  { id: 'ruby', label: 'Ruby (Net::HTTP)', lang: 'ruby' },
  { id: 'swift', label: 'Swift (URLSession)', lang: 'swift' },
  { id: 'kotlin', label: 'Kotlin (OkHttp)', lang: 'kotlin' },
  { id: 'rust', label: 'Rust (reqwest)', lang: 'rust' },
  { id: 'powershell', label: 'PowerShell', lang: 'powershell' },
  { id: 'httpie', label: 'HTTPie', lang: 'bash' }
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

/* ---------------- Java (OkHttp) ---------------- */
function genJava(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const b = bodyString(req.body)
  const hasBody = b != null
  const formdataNote =
    req.body.type === 'formdata' || req.body.type === 'binary'
      ? '// NOTE: multipart/binary uploads are best-effort — build a MultipartBody/file RequestBody manually.\n'
      : ''
  const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? 'application/json'
  const headerLines = headers.map((h) => `  .addHeader(${jStr(h.key)}, ${jStr(h.value)})`).join('\n')
  const bodyDecl = hasBody
    ? `RequestBody body = RequestBody.create(${jStr(b!)}, MediaType.parse(${jStr(ct)}));\n`
    : ''
  // OkHttp requires a body for methods that mandate one; pass null otherwise.
  const methodArg = hasBody ? 'body' : methodRequiresBody(req.method) ? 'RequestBody.create(new byte[0], null)' : 'null'
  return `${formdataNote}OkHttpClient client = new OkHttpClient();
${bodyDecl}Request request = new Request.Builder()
  .url(${jStr(effectiveUrl(req))})
  .method(${jStr(req.method)}, ${methodArg})
${headerLines}
  .build();
try (Response response = client.newCall(request).execute()) {
  System.out.println(response.code());
  System.out.println(response.body().string());
}`
}

function methodRequiresBody(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())
}

/* ---------------- C# (HttpClient) ---------------- */
function genCSharp(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const b = bodyString(req.body)
  const formdataNote =
    req.body.type === 'formdata' || req.body.type === 'binary'
      ? '// NOTE: multipart/binary uploads are best-effort — use MultipartFormDataContent / StreamContent manually.\n'
      : ''
  const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? 'application/json'
  // Content-Type belongs on the content, not the request headers, in HttpClient.
  const reqHeaders = headers.filter((h) => h.key.toLowerCase() !== 'content-type')
  const headerLines = reqHeaders.map((h) => `request.Headers.TryAddWithoutValidation(${csStr(h.key)}, ${csStr(h.value)});`).join('\n')
  const contentLine =
    b != null
      ? `request.Content = new StringContent(${csStr(b)}, System.Text.Encoding.UTF8, ${csStr(ct)});\n`
      : ''
  return `${formdataNote}using var client = new HttpClient();
var request = new HttpRequestMessage(new HttpMethod(${csStr(req.method)}), ${csStr(effectiveUrl(req))});
${headerLines}
${contentLine}var response = await client.SendAsync(request);
Console.WriteLine((int)response.StatusCode);
Console.WriteLine(await response.Content.ReadAsStringAsync());`
}

/* ---------------- PHP (cURL) ---------------- */
function genPhp(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const b = bodyString(req.body)
  const formdataNote =
    req.body.type === 'formdata' || req.body.type === 'binary'
      ? "// NOTE: multipart/binary uploads are best-effort — pass a CURLFile array as CURLOPT_POSTFIELDS.\n"
      : ''
  const headerArr = headers.map((h) => `    ${phpStr(`${h.key}: ${h.value}`)}`).join(',\n')
  const bodyLine = b != null ? `  CURLOPT_POSTFIELDS => ${phpStr(b)},\n` : ''
  return `${formdataNote}<?php
$ch = curl_init();
curl_setopt_array($ch, [
  CURLOPT_URL => ${phpStr(effectiveUrl(req))},
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CUSTOMREQUEST => ${phpStr(req.method)},
${bodyLine}  CURLOPT_HTTPHEADER => [
${headerArr}
  ],
]);
$response = curl_exec($ch);
echo curl_getinfo($ch, CURLINFO_HTTP_CODE) . PHP_EOL;
echo $response . PHP_EOL;
curl_close($ch);`
}

/* ---------------- Ruby (Net::HTTP) ---------------- */
function genRuby(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const b = bodyString(req.body)
  const formdataNote =
    req.body.type === 'formdata' || req.body.type === 'binary'
      ? '# NOTE: multipart/binary uploads are best-effort — use request.set_form / multipart manually.\n'
      : ''
  const methodConst = rubyRequestClass(req.method)
  const headerLines = headers.map((h) => `request[${rbStr(h.key)}] = ${rbStr(h.value)}`).join('\n')
  const bodyLine = b != null ? `request.body = ${rbStr(b)}\n` : ''
  return `${formdataNote}require 'net/http'
require 'uri'

uri = URI(${rbStr(effectiveUrl(req))})
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = uri.scheme == 'https'
request = ${methodConst}.new(uri)
${headerLines}
${bodyLine}response = http.request(request)
puts response.code
puts response.body`
}

function rubyRequestClass(method: string): string {
  const map: Record<string, string> = {
    GET: 'Net::HTTP::Get',
    POST: 'Net::HTTP::Post',
    PUT: 'Net::HTTP::Put',
    PATCH: 'Net::HTTP::Patch',
    DELETE: 'Net::HTTP::Delete',
    HEAD: 'Net::HTTP::Head',
    OPTIONS: 'Net::HTTP::Options'
  }
  return map[method.toUpperCase()] ?? 'Net::HTTP::Get'
}

/* ---------------- Swift (URLSession) ---------------- */
function genSwift(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const b = bodyString(req.body)
  const formdataNote =
    req.body.type === 'formdata' || req.body.type === 'binary'
      ? '// NOTE: multipart/binary uploads are best-effort — build the multipart body Data manually.\n'
      : ''
  const headerLines = headers
    .map((h) => `request.setValue(${swStr(h.value)}, forHTTPHeaderField: ${swStr(h.key)})`)
    .join('\n')
  const bodyLine = b != null ? `request.httpBody = ${swStr(b)}.data(using: .utf8)\n` : ''
  return `${formdataNote}import Foundation

var request = URLRequest(url: URL(string: ${swStr(effectiveUrl(req))})!)
request.httpMethod = ${swStr(req.method)}
${headerLines}
${bodyLine}let (data, response) = try await URLSession.shared.data(for: request)
if let http = response as? HTTPURLResponse {
    print(http.statusCode)
}
print(String(data: data, encoding: .utf8) ?? "")`
}

/* ---------------- Kotlin (OkHttp) ---------------- */
function genKotlin(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const b = bodyString(req.body)
  const hasBody = b != null
  const formdataNote =
    req.body.type === 'formdata' || req.body.type === 'binary'
      ? '// NOTE: multipart/binary uploads are best-effort — build a MultipartBody/file RequestBody manually.\n'
      : ''
  const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? 'application/json'
  const headerLines = headers.map((h) => `  .addHeader(${ktStr(h.key)}, ${ktStr(h.value)})`).join('\n')
  const bodyDecl = hasBody ? `val body = ${ktStr(b!)}.toRequestBody(${ktStr(ct)}.toMediaType())\n` : ''
  const methodArg = hasBody ? 'body' : methodRequiresBody(req.method) ? 'ByteArray(0).toRequestBody(null)' : 'null'
  return `${formdataNote}import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

val client = OkHttpClient()
${bodyDecl}val request = Request.Builder()
  .url(${ktStr(effectiveUrl(req))})
  .method(${ktStr(req.method)}, ${methodArg})
${headerLines}
  .build()
client.newCall(request).execute().use { response ->
  println(response.code)
  println(response.body?.string())
}`
}

/* ---------------- Rust (reqwest, blocking) ---------------- */
function genRust(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const b = bodyString(req.body)
  const formdataNote =
    req.body.type === 'formdata' || req.body.type === 'binary'
      ? '// NOTE: multipart/binary uploads are best-effort — use reqwest::blocking::multipart manually.\n'
      : ''
  const reqLine = rustRequestLine(req.method, effectiveUrl(req))
  const headerLines = headers.map((h) => `        .header(${rsStr(h.key)}, ${rsStr(h.value)})`).join('\n')
  const bodyLine = b != null ? `        .body(${rsStr(b)})\n` : ''
  return `${formdataNote}// Cargo.toml: reqwest = { version = "0.12", features = ["blocking"] }
use std::error::Error;

fn main() -> Result<(), Box<dyn Error>> {
    let client = reqwest::blocking::Client::new();
    let response = client
${reqLine}
${headerLines}
${bodyLine}        .send()?;
    println!("{}", response.status());
    println!("{}", response.text()?);
    Ok(())
}`
}

function rustRequestLine(method: string, url: string): string {
  const m = method.toUpperCase()
  const known: Record<string, string> = {
    GET: 'get',
    POST: 'post',
    PUT: 'put',
    PATCH: 'patch',
    DELETE: 'delete',
    HEAD: 'head'
  }
  if (known[m]) return `        .${known[m]}(${rsStr(url)})`
  return `        .request(reqwest::Method::from_bytes(b${rsStr(m)}).unwrap(), ${rsStr(url)})`
}

/* ---------------- PowerShell (Invoke-RestMethod) ---------------- */
function genPowerShell(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const b = bodyString(req.body)
  const formdataNote =
    req.body.type === 'formdata' || req.body.type === 'binary'
      ? '# NOTE: multipart/binary uploads are best-effort — use -Form or -InFile manually.\n'
      : ''
  const headerHash = headers.length
    ? `$headers = @{\n${headers.map((h) => `  ${psKey(h.key)} = ${psStr(h.value)}`).join('\n')}\n}\n`
    : ''
  const headersArg = headers.length ? ' -Headers $headers' : ''
  const bodyArg = b != null ? ` -Body ${psStr(b)}` : ''
  return `${formdataNote}${headerHash}$response = Invoke-RestMethod -Uri ${psStr(effectiveUrl(req))} -Method ${psStr(req.method)}${headersArg}${bodyArg}
$response | ConvertTo-Json -Depth 10`
}

/* ---------------- HTTPie (CLI) ---------------- */
function genHttpie(req: RequestModel): string {
  const headers = effectiveHeaders(req)
  const parts: string[] = ['http', req.method.toUpperCase(), shQuote(effectiveUrl(req))]
  for (const h of headers) parts.push(shQuote(`${h.key}:${h.value}`))
  if (req.body.type === 'urlencoded') {
    for (const i of req.body.items.filter((x) => x.enabled)) parts.push(shQuote(`${i.key}=${i.value}`))
  } else if (req.body.type === 'formdata') {
    parts.unshift('# NOTE: multipart upload is best-effort — use field@/path/to/file for files\n')
    for (const f of req.body.items.filter((x) => x.enabled))
      parts.push(shQuote(`${f.key}${f.type === 'file' ? '@' + (f.filePath ?? 'file') : '=' + f.value}`))
  } else if (req.body.type === 'binary') {
    parts.push(`< ${shQuote(req.body.filePath ?? 'file')}`)
  } else {
    const b = bodyString(req.body)
    // Raw/JSON bodies: pipe via stdin so {{vars}} and arbitrary JSON stay intact.
    if (b != null) return `echo ${shQuote(b)} | ${parts.join(' ')}`
  }
  return parts.join(' \\\n  ')
}

/* ---------------- string escapers ---------------- */
function jStr(s: string): string {
  // Java/JSON share the same escape rules for these characters.
  return JSON.stringify(s)
}
function ktStr(s: string): string {
  // Kotlin string literals also use $ for interpolation — escape it.
  return JSON.stringify(s).replace(/\$/g, '\\$')
}
function csStr(s: string): string {
  return JSON.stringify(s)
}
function swStr(s: string): string {
  // Swift uses \( ) interpolation; escaping backslashes via JSON.stringify covers it.
  return JSON.stringify(s)
}
function rsStr(s: string): string {
  return JSON.stringify(s)
}
function phpStr(s: string): string {
  // PHP single-quoted strings only need \ and ' escaped.
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}
function rbStr(s: string): string {
  return JSON.stringify(s)
}
function psStr(s: string): string {
  // PowerShell single-quoted: escape ' by doubling it; no other escapes apply.
  return `'${s.replace(/'/g, "''")}'`
}
function psKey(s: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : psStr(s)
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
    case 'java':
      return genJava(req)
    case 'csharp':
      return genCSharp(req)
    case 'php':
      return genPhp(req)
    case 'ruby':
      return genRuby(req)
    case 'swift':
      return genSwift(req)
    case 'kotlin':
      return genKotlin(req)
    case 'rust':
      return genRust(req)
    case 'powershell':
      return genPowerShell(req)
    case 'httpie':
      return genHttpie(req)
  }
}
