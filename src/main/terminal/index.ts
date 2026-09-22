/**
 * «Send to terminal»: run the current request with curl / HTTPie / wget /
 * PowerShell in a real terminal window.
 *
 * The renderer only hands over a RequestSpec (the same resolved request the
 * engine would send) and a tool id from a fixed list. Everything that ends up
 * in a shell — URL, headers, auth, body — is prepared here and quoted by
 * `@shared/terminal-command`; there is no channel that runs renderer text as a
 * command. Files go into a fresh private temp folder that the script removes
 * once the request has run.
 */
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { RequestSpec } from '@shared/types'
import {
  buildTerminalScript,
  TOOL_LABEL,
  toolsFor,
  type TerminalBody,
  type TerminalOs,
  type TerminalRequest,
  type TerminalTool
} from '@shared/terminal-command'
import { buildAuthHeaders, buildUrl, collectUserHeaders } from '../http/engine'
import { buildTokenAuth, signRequest } from '../auth/sign'
import { mainLanguage, mt } from '../i18n'

const TEMP_PREFIX = 'relay-term-'
const MAX_SIGNED_FILE_BYTES = 50 * 1024 * 1024
const RAW_CONTENT_TYPE: Record<string, string> = {
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript',
  text: 'text/plain'
}

export interface TerminalToolInfo {
  id: TerminalTool
  label: string
  /** the program was found on PATH (PowerShell is always there on Windows) */
  available: boolean
}

const osName = (): TerminalOs => (process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux')

/** Is `name` an executable somewhere on PATH? */
function onPath(name: string): boolean {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const file = join(dir, process.platform === 'win32' && !name.toLowerCase().endsWith(ext) ? name + ext : name)
      try {
        if (statSync(file).isFile()) return true
      } catch {
        // not here
      }
    }
  }
  return false
}

const PROGRAM: Record<TerminalTool, string> = { curl: 'curl', httpie: 'http', wget: 'wget', powershell: 'powershell' }

export function listTools(): TerminalToolInfo[] {
  return toolsFor(osName()).map((id) => ({
    id,
    label: TOOL_LABEL[id],
    available: id === 'powershell' || onPath(PROGRAM[id])
  }))
}

const findHeader = (headers: Record<string, string>, name: string): string | undefined =>
  Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]

/**
 * The request as the engine would put it on the wire: query and query-auth in
 * the URL, auth headers (incl. request-bound signatures) and the body's
 * content type. Challenge/response schemes (Digest, NTLM) are left to the tool.
 */
export function toTerminalRequest(spec: RequestSpec, extraNotes: string[] = []): TerminalRequest {
  const notes = [...extraNotes]
  let url = buildUrl(spec.url, spec.query ?? [])
  const headers = collectUserHeaders(spec.headers ?? [])
  const auth = spec.auth
  let credentials: TerminalRequest['credentials']

  if (auth?.type === 'digest' || auth?.type === 'ntlm') {
    credentials = { scheme: auth.type, username: auth.username ?? '', password: auth.password ?? '' }
  } else {
    const simple = buildAuthHeaders(auth)
    for (const [k, v] of Object.entries(simple.headers)) headers[k] = v
    const token = buildTokenAuth(auth)
    if (token) for (const [k, v] of Object.entries(token.headers)) headers[k] = v
    const queryAuth = simple.query ?? token?.query
    if (queryAuth) {
      const u = new URL(url)
      u.searchParams.append(queryAuth.key, queryAuth.value)
      url = u.toString()
    }
  }

  let body: TerminalBody = { kind: 'none' }
  let bodyForSign: string | Buffer | undefined
  const b = spec.body
  if (b?.type === 'raw') {
    // An empty editor is no body at all — not a zero-length one on a GET.
    if (b.text) {
      body = { kind: 'text', text: b.text }
      if (!findHeader(headers, 'content-type')) headers['Content-Type'] = RAW_CONTENT_TYPE[b.language] ?? 'text/plain'
    }
    bodyForSign = b.text ?? ''
  } else if (b?.type === 'urlencoded') {
    const params = new URLSearchParams()
    for (const kv of b.items ?? []) if (kv && kv.enabled !== false && kv.key) params.append(kv.key, kv.value ?? '')
    body = { kind: 'text', text: params.toString() }
    bodyForSign = body.text
    if (!findHeader(headers, 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded'
  } else if (b?.type === 'graphql') {
    let variables: unknown = {}
    try {
      variables = b.variables?.trim() ? JSON.parse(b.variables) : {}
    } catch {
      variables = {}
    }
    body = { kind: 'text', text: JSON.stringify({ query: b.query ?? '', variables }) }
    bodyForSign = body.text
    if (!findHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json'
  } else if (b?.type === 'formdata') {
    body = {
      kind: 'form',
      fields: (b.items ?? [])
        .filter((f) => f && f.enabled !== false && f.key && (f.type !== 'file' || f.filePath))
        .map((f) => (f.type === 'file' ? { name: f.key, filePath: f.filePath, fileName: f.fileName, contentType: f.contentType } : { name: f.key, value: f.value ?? '' }))
    }
  } else if (b?.type === 'binary' && b.filePath) {
    body = { kind: 'file', filePath: b.filePath }
    if (!findHeader(headers, 'content-type')) headers['Content-Type'] = b.contentType ?? 'application/octet-stream'
  }

  // Request-bound signatures cover the final URL, headers and body, exactly
  // as in runRequest; they stay valid for the few seconds until curl runs.
  if (auth && ['oauth1', 'aws', 'hawk', 'akamai'].includes(auth.type)) {
    if (body.kind === 'file') {
      try {
        if (statSync(body.filePath).size <= MAX_SIGNED_FILE_BYTES) bodyForSign = readFileSync(body.filePath)
      } catch {
        // unreadable: the tool will report the missing file itself
      }
    }
    const urlencodedParams =
      b?.type === 'urlencoded' ? Object.fromEntries(b.items.filter((i) => i.enabled && i.key).map((i) => [i.key, i.value ?? ''])) : undefined
    const signed = signRequest(auth, {
      method: (spec.method || 'GET').toUpperCase(),
      url,
      headers,
      body: bodyForSign,
      contentType: findHeader(headers, 'content-type'),
      urlencodedParams,
      unsignedBody: body.kind === 'form'
    })
    if (signed) for (const [k, v] of Object.entries(signed.headers)) headers[k] = v
  }

  const settings = spec.settings
  const proxy = settings?.proxy
  const proxyMode = proxy?.mode ?? (proxy?.enabled ? 'custom' : 'off')
  if (proxyMode === 'system') notes.push(mt('Системный прокси не передаётся — задайте его переменными окружения терминала.'))
  if (settings?.clientCerts?.length) notes.push(mt('Клиентские сертификаты не передаются.'))

  const acceptEncoding = findHeader(headers, 'accept-encoding')
  return {
    method: (spec.method || 'GET').toUpperCase(),
    url,
    headers: Object.entries(headers),
    body,
    credentials,
    insecure: settings?.rejectUnauthorized === false,
    followRedirects: settings?.followRedirects !== false,
    maxRedirects: Math.max(0, Math.min(settings?.maxRedirects ?? 10, 50)),
    timeoutSec: settings?.timeoutMs && settings.timeoutMs > 0 ? Math.ceil(settings.timeoutMs / 1000) : 0,
    proxy: proxyMode === 'custom' && proxy?.url ? { url: proxy.url, username: proxy.auth?.username, password: proxy.auth?.password } : undefined,
    caPath: settings?.caPath || undefined,
    compressed: !!acceptEncoding && /gzip|deflate|br/i.test(acceptEncoding),
    notes
  }
}

/** Remove folders earlier runs left behind (a terminal closed mid-run). */
function sweepOld(): void {
  const cutoff = Date.now() - 60 * 60 * 1000
  try {
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith(TEMP_PREFIX)) continue
      const path = join(tmpdir(), name)
      try {
        if (statSync(path).mtimeMs < cutoff) rmSync(path, { recursive: true, force: true })
      } catch {
        // in use or already gone
      }
    }
  } catch {
    // temp dir unreadable — nothing to sweep
  }
}

/** Terminal emulators tried on Linux, with the argv that runs a script in each. */
const LINUX_TERMINALS: [string, (script: string) => string[]][] = [
  ['x-terminal-emulator', (s) => ['-e', 'bash', s]],
  ['gnome-terminal', (s) => ['--', 'bash', s]],
  ['konsole', (s) => ['-e', 'bash', s]],
  ['xfce4-terminal', (s) => ['-x', 'bash', s]],
  ['mate-terminal', (s) => ['-x', 'bash', s]],
  ['kitty', (s) => ['bash', s]],
  ['alacritty', (s) => ['-e', 'bash', s]],
  ['wezterm', (s) => ['start', '--', 'bash', s]],
  ['foot', (s) => ['bash', s]],
  ['xterm', (s) => ['-e', 'bash', s]]
]

function openTerminal(os: TerminalOs, script: string): void {
  if (os === 'win32') {
    // `start` gives PowerShell a console of its own (a detached child would
    // have none); the Windows default terminal app picks it up.
    if (/["%^]/.test(script)) throw new Error(`Unsupported characters in the temp path: ${script}`)
    const line = `/d /c start "Relay" powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File "${script}"`
    spawn('cmd.exe', [line], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return
  }
  if (os === 'darwin') {
    spawn('open', ['-a', 'Terminal', script], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  const found = LINUX_TERMINALS.find(([name]) => onPath(name))
  if (!found) throw new Error(mt('Не найден эмулятор терминала (gnome-terminal, konsole, xterm…).'))
  spawn(found[0], found[1](script), { detached: true, stdio: 'ignore' }).unref()
}

export type TerminalRunResult = { ok: true; preview: string } | { ok: false; error: string }

export function runInTerminal(tool: TerminalTool, spec: RequestSpec, notes: string[]): TerminalRunResult {
  const os = osName()
  if (!toolsFor(os).includes(tool)) return { ok: false, error: `${TOOL_LABEL[tool] ?? tool} is not available on this system` }
  sweepOld()
  let dir: string | null = null
  try {
    const request = toTerminalRequest(spec, notes)
    dir = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
    if (os !== 'win32') chmodSync(dir, 0o700)
    const script = buildTerminalScript(tool, request, os, dir, mainLanguage() === 'ru' ? 'ru' : 'en')
    for (const f of script.files) {
      const path = join(dir, f.name)
      writeFileSync(path, (f.bom ? '﻿' : '') + f.content, { encoding: 'utf8', mode: f.executable ? 0o700 : 0o600 })
    }
    openTerminal(os, join(dir, script.entry))
    return { ok: true, preview: script.preview }
  } catch (err) {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    return { ok: false, error: (err as Error).message }
  }
}

/** The command as it would run, for the code dialog — nothing is written. */
export function previewCommand(tool: TerminalTool, spec: RequestSpec): string {
  const os = osName()
  const dir = os === 'win32' ? join(tmpdir(), `${TEMP_PREFIX}xxxxxx`) : `${tmpdir()}/${TEMP_PREFIX}xxxxxx`
  return buildTerminalScript(tool, toTerminalRequest(spec), os, dir, mainLanguage() === 'ru' ? 'ru' : 'en').preview
}

const isTool = (v: unknown): v is TerminalTool => v === 'curl' || v === 'httpie' || v === 'wget' || v === 'powershell'

export function registerTerminalHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.terminal.tools, () => ({ os: osName(), tools: listTools() }))
  ipcMain.handle(IPC.terminal.run, (_e, tool: unknown, spec: RequestSpec, notes: unknown) => {
    if (!isTool(tool)) return { ok: false, error: 'unknown tool' }
    const safeNotes = Array.isArray(notes) ? notes.filter((n): n is string => typeof n === 'string').slice(0, 10).map((n) => n.slice(0, 300)) : []
    return runInTerminal(tool, spec, safeNotes)
  })
  ipcMain.handle(IPC.terminal.preview, (_e, tool: unknown, spec: RequestSpec) => {
    if (!isTool(tool)) return ''
    try {
      return previewCommand(tool, spec)
    } catch (err) {
      return `# ${(err as Error).message}`
    }
  })
}
