/**
 * «Send to terminal»: turn a fully prepared request into a small script that
 * runs it with a command-line HTTP client in the user's own terminal.
 *
 * The main process writes the files this module returns into a fresh private
 * temp folder and opens a terminal on the entry script. Nothing here builds a
 * command from renderer text: every value is quoted for the target syntax
 * (curl config, POSIX shell, PowerShell), so a header or body can't break out
 * into the shell. Pure module — no Node/DOM — unit-tested.
 */

export type TerminalTool = 'curl' | 'httpie' | 'wget' | 'powershell'
export type TerminalOs = 'win32' | 'darwin' | 'linux'
export type TerminalLang = 'ru' | 'en'

export type TerminalBody =
  | { kind: 'none' }
  /** text body (raw / urlencoded / GraphQL), written to `body.txt` */
  | { kind: 'text'; text: string }
  | { kind: 'form'; fields: { name: string; value?: string; filePath?: string; fileName?: string; contentType?: string }[] }
  /** binary body read from a file on disk */
  | { kind: 'file'; filePath: string }

export interface TerminalRequest {
  method: string
  /** final URL, query and query-auth already applied */
  url: string
  /** headers to send, auth and content type already applied */
  headers: [string, string][]
  body: TerminalBody
  /** schemes that need the tool's own challenge/response handling */
  credentials?: { scheme: 'digest' | 'ntlm'; username: string; password: string }
  insecure: boolean
  followRedirects: boolean
  maxRedirects: number
  timeoutSec: number
  proxy?: { url: string; username?: string; password?: string }
  caPath?: string
  /** the user asked for a compressed response (Accept-Encoding) */
  compressed: boolean
  /** things the terminal run does differently from Relay — shown before the output */
  notes: string[]
}

export interface TerminalFile {
  name: string
  content: string
  /** prefix a UTF-8 BOM (Windows PowerShell 5.1 reads BOM-less scripts as ANSI) */
  bom?: boolean
  executable?: boolean
}

export interface TerminalScript {
  files: TerminalFile[]
  /** file name of the script the terminal runs */
  entry: string
  /** the equivalent command as a person would type it (shown in the terminal and the UI) */
  preview: string
}

export const TOOL_LABEL: Record<TerminalTool, string> = { curl: 'cURL', httpie: 'HTTPie', wget: 'wget', powershell: 'PowerShell' }

/** Tools that make sense on an OS (availability on PATH is checked separately). */
export function toolsFor(os: TerminalOs): TerminalTool[] {
  return os === 'win32' ? ['curl', 'httpie', 'powershell'] : ['curl', 'httpie', 'wget']
}

const MSG: Record<TerminalLang, Record<string, string>> = {
  ru: {
    missing: 'не найден. Установите его или выберите другой инструмент в Relay.',
    done: 'Готово. Временные файлы запроса удалены.',
    notes: 'Отличия от отправки из Relay:',
    formUnsupported: 'multipart/form-data этим инструментом не поддерживается — тело не отправлено. Используйте cURL.',
    binaryUnsupported: 'двоичное тело этим инструментом не поддерживается — тело не отправлено. Используйте cURL.',
    ntlmUnsupported: 'NTLM этим инструментом не поддерживается — авторизация не отправлена. Используйте cURL или PowerShell.'
  },
  en: {
    missing: 'was not found. Install it or pick another tool in Relay.',
    done: 'Done. The temporary request files were removed.',
    notes: 'Differences from sending in Relay:',
    formUnsupported: 'this tool cannot send multipart/form-data — the body was not sent. Use cURL.',
    binaryUnsupported: 'this tool cannot send a binary body — the body was not sent. Use cURL.',
    ntlmUnsupported: 'this tool cannot do NTLM — no auth was sent. Use cURL or PowerShell.'
  }
}

/* ------------------------------------------------------------------ quoting */

/** POSIX shell: single quotes, `'` as `'\''`. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** PowerShell string literal: single quotes, `'` doubled; nothing else expands. */
export function psQuote(s: string): string {
  return `'${s.replace(/['‘’‚‛]/g, (c) => c + c)}'`
}

/**
 * An argument for a NATIVE program called from Windows PowerShell 5.1, which
 * forwards embedded `"` unescaped: escape them (and the backslashes before
 * them) the way the MSVC runtime parses a command line.
 */
export function psNativeArg(s: string): string {
  let escaped = s.replace(/(\\*)"/g, (_m, bs: string) => `${bs}${bs}\\"`)
  // PowerShell wraps an argument with whitespace in quotes; trailing
  // backslashes would then escape that closing quote.
  if (/\s/.test(escaped)) escaped = escaped.replace(/(\\+)$/, '$1$1')
  return psQuote(escaped)
}

/** Value inside a curl config file (`key = "value"`). */
function curlStr(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`
}

/** Path of a file the script writes next to itself. */
function local(os: TerminalOs, dir: string, name: string): string {
  return os === 'win32' ? `${dir.replace(/[\\/]+$/, '')}\\${name}` : `${dir.replace(/\/+$/, '')}/${name}`
}

/* ------------------------------------------------------------------ cURL */

function curlConfig(req: TerminalRequest, os: TerminalOs, dir: string): string {
  const method = req.method.toUpperCase()
  // `-X HEAD` makes curl wait for a body that never comes; `--head` is the HEAD request.
  const lines: string[] = ['# Relay request for curl -K', `url = ${curlStr(req.url)}`, method === 'HEAD' ? 'head' : `request = ${curlStr(method)}`]
  // Status line and headers first, then the body; no progress meter.
  lines.push('include', 'silent', 'show-error', `write-out = ${curlStr('\n')}`)
  for (const [k, v] of req.headers) lines.push(v === '' ? `header = ${curlStr(`${k};`)}` : `header = ${curlStr(`${k}: ${v}`)}`)
  if (req.body.kind === 'text') lines.push(`data-binary = ${curlStr('@' + local(os, dir, 'body.txt'))}`)
  else if (req.body.kind === 'file') lines.push(`data-binary = ${curlStr('@' + req.body.filePath)}`)
  else if (req.body.kind === 'form') {
    for (const f of req.body.fields) {
      if (f.filePath != null) {
        let spec = `${f.name}=@"${f.filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        if (f.fileName) spec += `;filename="${f.fileName.replace(/"/g, '\\"')}"`
        if (f.contentType) spec += `;type=${f.contentType}`
        lines.push(`form = ${curlStr(spec)}`)
      } else lines.push(`form-string = ${curlStr(`${f.name}=${f.value ?? ''}`)}`)
    }
  }
  if (req.credentials) {
    lines.push(req.credentials.scheme === 'digest' ? 'digest' : 'ntlm', `user = ${curlStr(`${req.credentials.username}:${req.credentials.password}`)}`)
  }
  if (req.insecure) lines.push('insecure')
  if (req.followRedirects) lines.push('location', `max-redirs = ${req.maxRedirects}`)
  if (req.timeoutSec > 0) lines.push(`max-time = ${req.timeoutSec}`)
  if (req.proxy) {
    lines.push(`proxy = ${curlStr(req.proxy.url)}`)
    if (req.proxy.username) lines.push(`proxy-user = ${curlStr(`${req.proxy.username}:${req.proxy.password ?? ''}`)}`)
  }
  if (req.caPath) lines.push(`cacert = ${curlStr(req.caPath)}`)
  if (req.compressed) lines.push('compressed')
  return lines.join('\n') + '\n'
}

function curlPreview(req: TerminalRequest, os: TerminalOs): string {
  const q = os === 'win32' ? psNativeArg : shQuote
  const method = req.method.toUpperCase()
  // Program, method and URL stay on the first line; options wrap below.
  const parts = [`${os === 'win32' ? 'curl.exe' : 'curl'} -i ${method === 'HEAD' ? '-I' : `-X ${method}`} ${q(req.url)}`]
  for (const [k, v] of req.headers) parts.push('-H', q(v === '' ? `${k};` : `${k}: ${v}`))
  if (req.body.kind === 'text') parts.push('--data-binary', req.body.text.length <= 2000 ? q(req.body.text) : q('@body.txt'))
  else if (req.body.kind === 'file') parts.push('--data-binary', q('@' + req.body.filePath))
  else if (req.body.kind === 'form')
    for (const f of req.body.fields) parts.push(f.filePath != null ? '-F' : '--form-string', q(f.filePath != null ? `${f.name}=@${f.filePath}` : `${f.name}=${f.value ?? ''}`))
  if (req.credentials) parts.push(`--${req.credentials.scheme}`, '-u', q(`${req.credentials.username}:${'*'.repeat(8)}`))
  if (req.insecure) parts.push('-k')
  if (req.followRedirects) parts.push('-L', '--max-redirs', String(req.maxRedirects))
  if (req.timeoutSec > 0) parts.push('--max-time', String(req.timeoutSec))
  if (req.proxy) parts.push('-x', q(req.proxy.url))
  if (req.caPath) parts.push('--cacert', q(req.caPath))
  if (req.compressed) parts.push('--compressed')
  return wrapPreview(parts, os)
}

/* ------------------------------------------------------------------ HTTPie */

/** HTTPie request items treat `:`, `=`, `@` and `==` in the NAME as separators. */
const httpieName = (s: string): string => s.replace(/([:=@\\])/g, '\\$1')

function httpieArgs(req: TerminalRequest, notes: string[], t: Record<string, string>): string[] {
  const args: string[] = []
  if (req.insecure) args.push('--verify=no')
  if (req.followRedirects) args.push('--follow', `--max-redirects=${req.maxRedirects}`)
  if (req.timeoutSec > 0) args.push(`--timeout=${req.timeoutSec}`)
  if (req.proxy) {
    const u = new URLish(req.proxy.url, req.proxy.username, req.proxy.password)
    args.push(`--proxy=http:${u}`, `--proxy=https:${u}`)
  }
  if (req.caPath && !req.insecure) args.push(`--verify=${req.caPath}`)
  if (req.credentials) {
    if (req.credentials.scheme === 'digest') args.push('--auth-type=digest', `--auth=${req.credentials.username}:${req.credentials.password}`)
    else notes.push(t.ntlmUnsupported)
  }
  if (req.body.kind === 'form') args.push('--multipart')
  if (req.body.kind === 'none' || req.body.kind === 'form') args.push('--ignore-stdin')
  args.push(req.method.toUpperCase(), req.url)
  // `Name:` sends no header; an empty value needs HTTPie's `Name;` form.
  for (const [k, v] of req.headers) args.push(v === '' ? `${httpieName(k)};` : `${httpieName(k)}:${v}`)
  if (req.body.kind === 'form') {
    for (const f of req.body.fields) {
      args.push(f.filePath != null ? `${httpieName(f.name)}@${f.filePath}${f.contentType ? `;type=${f.contentType}` : ''}` : `${httpieName(f.name)}=${f.value ?? ''}`)
    }
  }
  return args
}

/** `http://user:pass@host` for HTTPie's --proxy, credentials percent-encoded. */
class URLish {
  constructor(
    private url: string,
    private user?: string,
    private pass?: string
  ) {}
  toString(): string {
    if (!this.user) return this.url
    const m = /^([a-z][a-z0-9+.-]*:\/\/)(.*)$/i.exec(this.url)
    const creds = `${encodeURIComponent(this.user)}:${encodeURIComponent(this.pass ?? '')}@`
    return m ? m[1] + creds + m[2] : creds + this.url
  }
}

/* ------------------------------------------------------------------ wget */

function wgetArgs(req: TerminalRequest, os: TerminalOs, dir: string, notes: string[], t: Record<string, string>): string[] {
  const args = ['--server-response', '--content-on-error', '--output-document=-', `--method=${req.method.toUpperCase()}`]
  for (const [k, v] of req.headers) args.push(`--header=${k}: ${v}`)
  if (req.body.kind === 'text') args.push(`--body-file=${local(os, dir, 'body.txt')}`)
  else if (req.body.kind === 'file') args.push(`--body-file=${req.body.filePath}`)
  else if (req.body.kind === 'form') notes.push(t.formUnsupported)
  if (req.credentials) {
    if (req.credentials.scheme === 'digest') args.push(`--user=${req.credentials.username}`, `--password=${req.credentials.password}`)
    else notes.push(t.ntlmUnsupported)
  }
  if (req.insecure) args.push('--no-check-certificate')
  args.push(`--max-redirect=${req.followRedirects ? req.maxRedirects : 0}`)
  if (req.timeoutSec > 0) args.push(`--timeout=${req.timeoutSec}`)
  if (req.proxy) {
    const u = String(new URLish(req.proxy.url, req.proxy.username, req.proxy.password))
    args.push('-e', 'use_proxy=yes', '-e', `http_proxy=${u}`, '-e', `https_proxy=${u}`)
  }
  if (req.caPath) args.push(`--ca-certificate=${req.caPath}`)
  if (req.compressed) args.push('--compression=auto')
  args.push(req.url)
  return args
}

/* ------------------------------------------------------------------ PowerShell */

/** Headers Windows PowerShell 5.1 refuses in -Headers; they go through parameters. */
const PS_RESTRICTED = new Set(['content-type', 'user-agent', 'content-length', 'host', 'connection', 'transfer-encoding', 'expect'])

/**
 * The `$params` splat for Invoke-WebRequest. With `masked`, passwords are
 * starred out — that variant is only ever shown, never run.
 */
function powershellParams(req: TerminalRequest, os: TerminalOs, dir: string, notes: string[], t: Record<string, string>, masked = false): string[] {
  const secret = (s: string): string => (masked ? '********' : s)
  const L: string[] = []
  L.push('$params = @{')
  L.push(`  Uri = ${psQuote(req.url)}`)
  L.push(`  Method = ${psQuote(req.method.toUpperCase())}`)
  L.push('  UseBasicParsing = $true')
  L.push(`  MaximumRedirection = ${req.followRedirects ? req.maxRedirects : 0}`)
  if (req.timeoutSec > 0) L.push(`  TimeoutSec = ${req.timeoutSec}`)
  L.push('}')
  const headers = req.headers.filter(([k]) => !PS_RESTRICTED.has(k.toLowerCase()))
  if (headers.length) {
    L.push('$params.Headers = @{')
    for (const [k, v] of headers) L.push(`  ${psQuote(k)} = ${psQuote(v)}`)
    L.push('}')
  }
  const ct = req.headers.find(([k]) => k.toLowerCase() === 'content-type')
  const ua = req.headers.find(([k]) => k.toLowerCase() === 'user-agent')
  if (ct) L.push(`$params.ContentType = ${psQuote(ct[1])}`)
  if (ua) L.push(`$params.UserAgent = ${psQuote(ua[1])}`)
  if (req.body.kind === 'text') L.push(`$params.Body = [System.IO.File]::ReadAllBytes(${psQuote(local(os, dir, 'body.txt'))})`)
  else if (req.body.kind === 'file') L.push(`$params.Body = [System.IO.File]::ReadAllBytes(${psQuote(req.body.filePath)})`)
  else if (req.body.kind === 'form') notes.push(t.formUnsupported)
  if (req.credentials)
    L.push(
      `$params.Credential = New-Object System.Management.Automation.PSCredential(${psQuote(req.credentials.username)}, (ConvertTo-SecureString ${psQuote(secret(req.credentials.password))} -AsPlainText -Force))`
    )
  if (req.proxy) {
    L.push(`$params.Proxy = ${psQuote(req.proxy.url)}`)
    if (req.proxy.username)
      L.push(
        `$params.ProxyCredential = New-Object System.Management.Automation.PSCredential(${psQuote(req.proxy.username)}, (ConvertTo-SecureString ${psQuote(secret(req.proxy.password ?? ''))} -AsPlainText -Force))`
      )
  }
  if (req.insecure) L.push('[Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }')
  return L
}

function powershellScript(req: TerminalRequest, os: TerminalOs, dir: string, notes: string[], t: Record<string, string>): string {
  const L = powershellParams(req, os, dir, notes, t)
  L.push('[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls')
  L.push('[Net.ServicePointManager]::Expect100Continue = $false')
  // Print it like curl -i: status line, headers, blank line, body — also for 4xx/5xx.
  L.push('try {')
  L.push('  $r = Invoke-WebRequest @params')
  L.push('  Write-Host ("HTTP " + [int]$r.StatusCode + " " + $r.StatusDescription) -ForegroundColor Green')
  L.push('  foreach ($k in $r.Headers.Keys) { Write-Host ($k + ": " + $r.Headers[$k]) }')
  L.push("  Write-Host ''")
  // Without a charset Windows PowerShell decodes as Latin-1; APIs send UTF-8.
  L.push(
    "  if ([string]$r.Headers['Content-Type'] -match 'charset=') { Write-Output $r.Content } else { Write-Output ([System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())) }"
  )
  L.push('} catch [System.Net.WebException] {')
  L.push('  $resp = $_.Exception.Response')
  L.push('  if ($resp) {')
  L.push('    Write-Host ("HTTP " + [int]$resp.StatusCode + " " + $resp.StatusDescription) -ForegroundColor Yellow')
  L.push('    foreach ($k in $resp.Headers.AllKeys) { Write-Host ($k + ": " + $resp.Headers[$k]) }')
  L.push("    Write-Host ''")
  L.push('    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)')
  L.push('    Write-Output $reader.ReadToEnd()')
  L.push('  } else { Write-Host $_.Exception.Message -ForegroundColor Red }')
  L.push('} catch { Write-Host $_.Exception.Message -ForegroundColor Red }')
  return L.join('\n')
}

/* ------------------------------------------------------------------ assembly */

function wrapPreview(parts: string[], os: TerminalOs): string {
  // One option per line reads better than a 400-character line.
  const cont = os === 'win32' ? ' `\n  ' : ' \\\n  '
  const out: string[] = []
  let line = ''
  for (const p of parts) {
    if (p.startsWith('-') && line) {
      out.push(line)
      line = p
    } else line = line ? `${line} ${p}` : p
  }
  if (line) out.push(line)
  return out.join(cont)
}

const bashList = (args: string[]): string => args.map(shQuote).join(' ')
const psList = (args: string[]): string => args.map(psNativeArg).join(' ')

/**
 * Everything the terminal needs for one run. `dir` is the absolute folder the
 * files will be written to (the scripts reference the body file by path).
 */
export function buildTerminalScript(tool: TerminalTool, req: TerminalRequest, os: TerminalOs, dir: string, lang: TerminalLang = 'ru'): TerminalScript {
  const t = MSG[lang]
  const notes = [...req.notes]
  // Windows PowerShell can only pipe text into a native program.
  if (req.body.kind === 'file' && tool === 'httpie' && os === 'win32') notes.push(t.binaryUnsupported)
  const files: TerminalFile[] = []
  if (req.body.kind === 'text') files.push({ name: 'body.txt', content: req.body.text })

  let run: string
  let preview: string
  const exe = tool === 'curl' ? (os === 'win32' ? 'curl.exe' : 'curl') : tool === 'httpie' ? 'http' : tool === 'wget' ? 'wget' : 'powershell'
  if (tool === 'curl') {
    files.push({ name: 'request.curlrc', content: curlConfig(req, os, dir) })
    preview = curlPreview(req, os)
    run = os === 'win32' ? `& curl.exe -K ${psQuote(local(os, dir, 'request.curlrc'))}` : `curl -K ${shQuote(local(os, dir, 'request.curlrc'))}`
  } else if (tool === 'httpie') {
    const args = httpieArgs(req, notes, t)
    const body = req.body.kind === 'text' ? local(os, dir, 'body.txt') : req.body.kind === 'file' ? req.body.filePath : null
    if (os === 'win32') {
      const call = `& http ${psList(args)}`
      run =
        body && req.body.kind === 'text'
          ? `[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n[System.IO.File]::ReadAllText(${psQuote(body)}) | ${call.slice(2)}`
          : call
      preview = wrapPreview(['http', ...args.map(psNativeArg)], os)
    } else {
      run = `http ${bashList(args)}${body ? ` < ${shQuote(body)}` : ''}`
      preview = wrapPreview(['http', ...args.map(shQuote)], os) + (body ? ` < ${shQuote(req.body.kind === 'text' ? 'body.txt' : body)}` : '')
    }
  } else if (tool === 'wget') {
    const args = wgetArgs(req, os, dir, notes, t)
    run = `wget ${bashList(args)}`
    preview = wrapPreview(['wget', ...args.map(shQuote)], os)
  } else {
    run = powershellScript(req, os, dir, notes, t)
    preview = [...powershellParams(req, os, dir, [], t, true), 'Invoke-WebRequest @params'].join('\n')
  }

  const header = `Relay → ${TOOL_LABEL[tool]}`
  const noteText = notes.length ? [t.notes, ...notes.map((n) => `  • ${n}`)].join('\n') : ''
  files.push({ name: 'command.txt', content: preview + '\n', bom: os === 'win32' })
  if (noteText) files.push({ name: 'notes.txt', content: noteText + '\n', bom: os === 'win32' })

  if (os === 'win32') {
    const lines = [
      "$ErrorActionPreference = 'Continue'",
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      `$Host.UI.RawUI.WindowTitle = ${psQuote(header)}`,
      `Write-Host ${psQuote(header)} -ForegroundColor Cyan`,
      `Get-Content -LiteralPath ${psQuote(local(os, dir, 'command.txt'))} -Encoding UTF8 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }`,
      noteText ? `Get-Content -LiteralPath ${psQuote(local(os, dir, 'notes.txt'))} -Encoding UTF8 | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }` : '',
      "Write-Host ''",
      tool === 'powershell'
        ? run
        : `if (Get-Command ${exe} -ErrorAction SilentlyContinue) {\n${run}\n} else { Write-Host ${psQuote(`${exe} ${t.missing}`)} -ForegroundColor Red }`,
      "Write-Host ''",
      `Set-Location -LiteralPath $HOME; Remove-Item -LiteralPath ${psQuote(dir)} -Recurse -Force -ErrorAction SilentlyContinue`,
      `Write-Host ${psQuote(t.done)} -ForegroundColor DarkGray`
    ]
    files.push({ name: 'run.ps1', content: lines.filter(Boolean).join('\r\n') + '\r\n', bom: true })
    return { files, entry: 'run.ps1', preview }
  }

  const lines = [
    '#!/usr/bin/env bash',
    `printf '\\033[1;36m%s\\033[0m\\n' ${shQuote(header)}`,
    `printf '\\033[2m'; cat ${shQuote(local(os, dir, 'command.txt'))}; printf '\\033[0m'`,
    noteText ? `printf '\\033[33m'; cat ${shQuote(local(os, dir, 'notes.txt'))}; printf '\\033[0m'` : '',
    'echo',
    `if command -v ${exe} >/dev/null 2>&1; then`,
    `  ${run}`,
    'else',
    `  printf '\\033[31m%s\\033[0m\\n' ${shQuote(`${exe} ${t.missing}`)}`,
    'fi',
    'echo',
    `cd ~ && rm -rf -- ${shQuote(dir)}`,
    `printf '\\033[2m%s\\033[0m\\n' ${shQuote(t.done)}`,
    // Leave a live shell so the window stays and the output can be read.
    'exec "${SHELL:-/bin/bash}" -i'
  ]
  const entry = os === 'darwin' ? 'run.command' : 'run.sh'
  files.push({ name: entry, content: lines.filter(Boolean).join('\n') + '\n', executable: true })
  return { files, entry, preview }
}
