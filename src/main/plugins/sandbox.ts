/**
 * The pure plugin-event runner. Executed inside an isolated CHILD PROCESS (see
 * `./host.ts`) launched with `--disallow-code-generation-from-strings` — the
 * same threat model and layering as the `pm.*` script sandbox
 * (`src/main/scripting/sandbox.ts`). No Electron / IPC / fs concerns here so it
 * stays unit-testable.
 *
 * The plugin's `main.js` is evaluated in a `node:vm` context whose only globals
 * are a frozen `relay` API and a capturing `console`. Capabilities are gated by
 * the GRANTED permission list in the payload (the manager already intersected
 * grants with the manifest); `relay.fetch` additionally enforces `net:<host>`
 * scoping, including on the post-redirect final URL.
 */
import { createContext, runInContext } from 'node:vm'
import { CREDENTIAL_HEADER_RE } from '../http/engine'
import type {
  PluginEventContext,
  PluginPermission,
  PluginRequestPatch,
  PluginRunRequest,
  PluginRunResult,
  PluginToast,
  ScriptConsoleLine
} from '@shared/types'

/** Synchronous evaluation bound for main.js top-level code. */
const SYNC_TIMEOUT_MS = 3000
/** How long an async handler may keep running after the sync phase. */
const ASYNC_TIMEOUT_MS = 10_000
/** relay.fetch: per-call timeout (spans the whole redirect chain), max calls
 *  per event, response byte cap, redirect hop cap. */
const FETCH_TIMEOUT_MS = 10_000
const FETCH_MAX_CALLS = 5
const FETCH_MAX_RESPONSE_BYTES = 1024 * 1024
const FETCH_MAX_REDIRECTS = 5
/** Console capture caps so a chatty plugin can't bloat the IPC result. */
const MAX_LOG_LINES = 200
const MAX_LOG_CHARS = 2000
const MAX_TOAST_CHARS = 300
/** Plugin-scoped storage caps (snapshot in, updates out). */
const MAX_STORAGE_KEYS = 100
const MAX_STORAGE_VALUE_CHARS = 8192
/** Panel HTML cap (rendered in a sandboxed iframe). */
const MAX_PANEL_HTML_CHARS = 256 * 1024
/** Bounded sandbox timers. */
const MAX_TIMERS = 50
const MAX_TIMER_DELAY_MS = 5000
/** Clipboard write cap. */
const MAX_CLIPBOARD_CHARS = 100_000

/**
 * The response object handed back to plugin code from `relay.fetch`. Mirrors
 * `pm.sendRequest`'s shape (methods, not raw fields) — it never crosses the
 * fork boundary, so functions are fine, exactly like the pm sandbox.
 */
export interface RelayFetchResult {
  ok: boolean
  status: number
  statusText: string
  /** true when the body was cut at the byte cap */
  truncated: boolean
  headers: { get: (name: string) => string | undefined; all: () => Record<string, string> }
  text: () => string
  json: () => unknown
}

/**
 * `net` allows any host; `net:<host>` allows that host (exact or `*.suffix`),
 * optionally port-qualified. The pattern's port is compared against the URL's
 * EFFECTIVE port (WHATWG URL drops default ports, so `net:example.com:443`
 * must still match `https://example.com/`); a pattern without a port matches
 * any port.
 */
export function hostAllowed(url: string, permissions: PluginPermission[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (permissions.includes('net')) return true
  const host = parsed.hostname.toLowerCase()
  const effectivePort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
  for (const p of permissions) {
    if (!p.startsWith('net:')) continue
    const pattern = p.slice('net:'.length).toLowerCase()
    // Split a trailing :port off the pattern (HOST_RE admits no IPv6 brackets).
    let patternHost = pattern
    let patternPort: string | null = null
    const colon = pattern.lastIndexOf(':')
    if (colon > 0 && /^\d+$/.test(pattern.slice(colon + 1))) {
      patternHost = pattern.slice(0, colon)
      patternPort = pattern.slice(colon + 1)
    }
    if (patternPort && patternPort !== effectivePort) continue
    if (patternHost.startsWith('*.')) {
      const suffix = patternHost.slice(2)
      if (host === suffix || host.endsWith(`.${suffix}`)) return true
    } else if (patternHost === host) {
      return true
    }
  }
  return false
}

/** Read a fetch Response body as text, capped at `FETCH_MAX_RESPONSE_BYTES`. */
async function readBodyCapped(res: Response): Promise<{ text: string; truncated: boolean }> {
  const body = res.body
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    let truncated = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        total += value.byteLength
        if (total > FETCH_MAX_RESPONSE_BYTES) {
          truncated = true
          const keep = value.byteLength - (total - FETCH_MAX_RESPONSE_BYTES)
          if (keep > 0) chunks.push(value.subarray(0, keep))
          try {
            await reader.cancel()
          } catch {
            /* already closed */
          }
          break
        }
        chunks.push(value)
      }
    }
    return { text: Buffer.concat(chunks).toString('utf8'), truncated }
  }
  // Stub/odd implementations without a stream: fall back to text() + truncate.
  const text = await res.text()
  return {
    text: text.length > FETCH_MAX_RESPONSE_BYTES ? text.slice(0, FETCH_MAX_RESPONSE_BYTES) : text,
    truncated: text.length > FETCH_MAX_RESPONSE_BYTES
  }
}

interface FetchState {
  calls: number
}

/** Plugin-facing fetch init: only method/headers/body pass through, sanitized. */
interface RelayFetchInit {
  method?: unknown
  headers?: unknown
  body?: unknown
}

async function performFetch(
  url: unknown,
  init: RelayFetchInit | undefined,
  permissions: PluginPermission[],
  state: FetchState
): Promise<RelayFetchResult> {
  const hasNet = permissions.some((p) => p === 'net' || p.startsWith('net:'))
  if (!hasNet) throw new Error("relay.fetch requires the 'net' permission")
  if (state.calls >= FETCH_MAX_CALLS) throw new Error(`relay.fetch: at most ${FETCH_MAX_CALLS} calls per event`)
  state.calls++

  let currentUrl = String(url ?? '')
  let method = typeof init?.method === 'string' ? init.method.toUpperCase() : 'GET'
  const headers: Record<string, string> = {}
  if (init?.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)) {
    for (const [k, v] of Object.entries(init.headers as Record<string, unknown>)) {
      if (typeof k === 'string' && k.length <= 200) headers[k] = String(v ?? '').slice(0, 4096)
    }
  }
  let body = typeof init?.body === 'string' ? init.body : undefined

  // One timeout spans the WHOLE redirect chain, as do the byte/hop caps.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    for (let hop = 0; ; hop++) {
      // Redirects are followed MANUALLY so a `net:<host>` grant is re-checked
      // on every hop — a 302 from a granted host must not smuggle the request
      // to an unapproved one (docs/PLUGINS.md §8).
      if (!hostAllowed(currentUrl, permissions)) {
        throw new Error(
          hop === 0
            ? `relay.fetch: host not allowed by granted permissions (${currentUrl})`
            : `relay.fetch: redirected to a host not allowed by granted permissions (${currentUrl})`
        )
      }

      const reqInit: RequestInit = { method, headers, redirect: 'manual', signal: controller.signal }
      if (body != null && method !== 'GET' && method !== 'HEAD') reqInit.body = body
      const res = await fetch(currentUrl, reqInit)

      const location =
        res.status >= 300 && res.status < 400 && typeof res.headers?.get === 'function'
          ? res.headers.get('location')
          : null
      if (location) {
        if (hop >= FETCH_MAX_REDIRECTS) throw new Error('relay.fetch: too many redirects')
        try {
          await res.body?.cancel()
        } catch {
          /* ignore */
        }
        const nextUrl = new URL(location, currentUrl).toString()
        // Mirror the HTTP engine: credential-bearing headers never survive a
        // cross-origin hop.
        if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
          for (const k of Object.keys(headers)) {
            if (CREDENTIAL_HEADER_RE.test(k)) delete headers[k]
          }
        }
        if (res.status === 301 || res.status === 302 || res.status === 303) {
          method = 'GET'
          body = undefined
        }
        currentUrl = nextUrl
        continue
      }

      const { text, truncated } = await readBodyCapped(res)
      const resHeaders: Record<string, string> = {}
      if (res.headers && typeof res.headers.forEach === 'function') {
        res.headers.forEach((value, key) => {
          resHeaders[key.toLowerCase()] = value
        })
      }
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        truncated,
        headers: {
          get: (name: string) => resHeaders[String(name).toLowerCase()],
          all: () => ({ ...resHeaders })
        },
        text: () => text,
        json: () => JSON.parse(text) as unknown
      }
    }
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`relay.fetch: timed out after ${FETCH_TIMEOUT_MS / 1000}s`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** JSON round-trip so only plain serializable data crosses realm boundaries. */
function jsonSafe<T>(v: T): T | undefined {
  try {
    return JSON.parse(JSON.stringify(v)) as T
  } catch {
    return undefined
  }
}

/** Error message that survives the vm realm boundary (an Error thrown inside
 *  the sandbox is NOT an instanceof the host Error). */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}

export async function runPluginEvent(payload: PluginRunRequest): Promise<PluginRunResult> {
  const logs: ScriptConsoleLine[] = []
  let toast: PluginToast | undefined
  let panelHtml: string | undefined
  let clipboardWrite: string | undefined
  const fetchState: FetchState = { calls: 0 }
  const permissions = payload.permissions ?? []

  // Bounded timers: plugin code may `await new Promise(r => setTimeout(r, ms))`.
  // Delays are capped, count-limited, and all cleared at finalize so nothing
  // outlives the run.
  const liveTimers = new Set<ReturnType<typeof setTimeout>>()
  const sandboxSetTimeout = (fn: unknown, delay?: unknown): ReturnType<typeof setTimeout> | undefined => {
    if (typeof fn !== 'function') return undefined
    if (liveTimers.size >= MAX_TIMERS) throw new Error(`relay sandbox: at most ${MAX_TIMERS} timers`)
    const ms = Math.min(Math.max(0, Number(delay) || 0), MAX_TIMER_DELAY_MS)
    const fire = fn as () => void
    const id = setTimeout(() => {
      liveTimers.delete(id)
      try {
        fire()
      } catch {
        /* swallowed — same as a normal uncaught timer error */
      }
    }, ms)
    liveTimers.add(id)
    return id
  }
  const sandboxClearTimeout = (id: unknown): void => {
    clearTimeout(id as ReturnType<typeof setTimeout>)
    liveTimers.delete(id as ReturnType<typeof setTimeout>)
  }

  // Plugin-scoped storage (`storage` perm): snapshot in, mutations recorded out.
  const store: Record<string, string> = { ...(payload.storage ?? {}) }
  const storageUpdates: Record<string, string | null> = {}
  const hasStorage = permissions.includes('storage')

  // Request mutations (`request:write`, only meaningful for the `request` event).
  const canWriteRequest = permissions.includes('request:write') && payload.event.type === 'request'
  const headerOps: { op: 'set' | 'remove'; key: string; value?: string }[] = []
  const requestPatch: PluginRequestPatch = {}
  let requestPatched = false

  const log =
    (level: ScriptConsoleLine['level']) =>
    (...args: unknown[]) => {
      if (logs.length >= MAX_LOG_LINES) return
      const message = args
        .map((a) => {
          if (typeof a === 'string') return a
          try {
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        })
        .join(' ')
      logs.push({ level, message: message.slice(0, MAX_LOG_CHARS) })
    }

  const handlers = new Map<string, (ctx: unknown) => unknown>()

  const storage = Object.freeze({
    get: (key: unknown): string | undefined => {
      if (!hasStorage) throw new Error("relay.storage requires the 'storage' permission")
      return store[String(key)]
    },
    has: (key: unknown): boolean => {
      if (!hasStorage) throw new Error("relay.storage requires the 'storage' permission")
      return Object.prototype.hasOwnProperty.call(store, String(key))
    },
    set: (key: unknown, value: unknown): void => {
      if (!hasStorage) throw new Error("relay.storage requires the 'storage' permission")
      const k = String(key)
      if (!k) return
      if (!Object.prototype.hasOwnProperty.call(store, k) && Object.keys(store).length >= MAX_STORAGE_KEYS) {
        throw new Error(`relay.storage: at most ${MAX_STORAGE_KEYS} keys`)
      }
      const v = String(value ?? '').slice(0, MAX_STORAGE_VALUE_CHARS)
      store[k] = v
      storageUpdates[k] = v
    },
    delete: (key: unknown): void => {
      if (!hasStorage) throw new Error("relay.storage requires the 'storage' permission")
      const k = String(key)
      delete store[k]
      storageUpdates[k] = null
    },
    keys: (): string[] => {
      if (!hasStorage) throw new Error("relay.storage requires the 'storage' permission")
      return Object.keys(store)
    }
  })

  const request = Object.freeze({
    setUrl: (url: unknown): void => {
      if (!canWriteRequest) throw new Error("relay.request requires the 'request:write' permission in a 'request' handler")
      requestPatch.url = String(url ?? '').slice(0, 8192)
      requestPatched = true
    },
    setMethod: (method: unknown): void => {
      if (!canWriteRequest) throw new Error("relay.request requires the 'request:write' permission in a 'request' handler")
      requestPatch.method = String(method ?? '').slice(0, 32).toUpperCase()
      requestPatched = true
    },
    setHeader: (key: unknown, value: unknown): void => {
      if (!canWriteRequest) throw new Error("relay.request requires the 'request:write' permission in a 'request' handler")
      const k = String(key ?? '').slice(0, 200)
      if (!k) return
      headerOps.push({ op: 'set', key: k, value: String(value ?? '').slice(0, 4096) })
      requestPatched = true
    },
    removeHeader: (key: unknown): void => {
      if (!canWriteRequest) throw new Error("relay.request requires the 'request:write' permission in a 'request' handler")
      const k = String(key ?? '').slice(0, 200)
      if (k) headerOps.push({ op: 'remove', key: k })
      requestPatched = true
    }
  })

  const relay = Object.freeze({
    on: (event: unknown, fn: unknown): void => {
      if (typeof event === 'string' && typeof fn === 'function') {
        handlers.set(event, fn as (ctx: unknown) => unknown)
      }
    },
    config: Object.freeze({ ...(payload.config ?? {}) }),
    storage,
    request,
    toast: (message: unknown, kind?: unknown): void => {
      toast = {
        message: String(message ?? '').slice(0, MAX_TOAST_CHARS),
        kind: kind === 'error' ? 'error' : 'ok'
      }
    },
    panel: Object.freeze({
      set: (html: unknown): void => {
        panelHtml = String(html ?? '').slice(0, MAX_PANEL_HTML_CHARS)
      }
    }),
    clipboard: Object.freeze({
      writeText: (text: unknown): void => {
        if (!permissions.includes('clipboard')) throw new Error("relay.clipboard requires the 'clipboard' permission")
        clipboardWrite = String(text ?? '').slice(0, MAX_CLIPBOARD_CHARS)
      }
    }),
    fetch: (url: unknown, init?: RelayFetchInit) => performFetch(url, init, permissions, fetchState),
    log: log('log'),
    info: log('info'),
    warn: log('warn'),
    error: log('error')
  })

  const sandboxConsole = {
    log: log('log'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    debug: log('log')
  }

  // Disallow eval / new Function inside the sandbox realm (defense in depth on
  // top of the process-level --disallow-code-generation-from-strings flag).
  // Bounded setTimeout/clearTimeout let plugins schedule short delays.
  const context = createContext(
    { relay, console: sandboxConsole, setTimeout: sandboxSetTimeout, clearTimeout: sandboxClearTimeout },
    { codeGeneration: { strings: false, wasm: false } }
  )

  const finalize = (error?: string): PluginRunResult => {
    for (const id of liveTimers) clearTimeout(id)
    liveTimers.clear()
    const result: PluginRunResult = { logs }
    if (toast) result.toast = toast
    if (Object.keys(storageUpdates).length) result.storageUpdates = storageUpdates
    if (requestPatched) {
      if (headerOps.length) requestPatch.headerOps = headerOps
      result.requestPatch = requestPatch
    }
    if (panelHtml != null) result.panelHtml = panelHtml
    if (clipboardWrite != null) result.clipboardWrite = clipboardWrite
    if (error != null) result.error = error
    return jsonSafe(result) ?? { logs: [], error: 'plugin result was not serializable' }
  }

  // Phase 1: evaluate main.js (registers handlers via relay.on).
  try {
    runInContext(payload.code, context, { timeout: SYNC_TIMEOUT_MS, displayErrors: true })
  } catch (err) {
    return finalize(errorMessage(err))
  }

  // Phase 2: dispatch the event to the matching handler.
  const ev = payload.event
  let handler: ((ctx: unknown) => unknown) | undefined
  if (ev.type === 'button') {
    handler = handlers.get(`button:${ev.buttonId}`) ?? handlers.get('button')
  } else if (ev.type === 'panel') {
    handler = handlers.get(`panel:${ev.panelId}`) ?? handlers.get('panel')
  } else if (ev.type === 'command') {
    handler = handlers.get(`command:${ev.commandId}`) ?? handlers.get('command')
  } else {
    handler = handlers.get(ev.type) // 'response' | 'request' | 'workspace' | 'collection'
  }

  if (!handler) {
    // A button/panel/command without a handler is an authoring bug worth
    // surfacing; a missing lifecycle-hook handler is simply "nothing to do".
    if (ev.type === 'button') {
      return finalize(`plugin has no handler for button "${ev.buttonId}" (relay.on('button:${ev.buttonId}', …))`)
    }
    if (ev.type === 'panel') {
      return finalize(`plugin has no handler for panel "${ev.panelId}" (relay.on('panel:${ev.panelId}', …))`)
    }
    if (ev.type === 'command') {
      return finalize(`plugin has no handler for command "${ev.commandId}" (relay.on('command:${ev.commandId}', …))`)
    }
    return finalize()
  }

  const ctx: PluginEventContext & { buttonId?: string; panelId?: string; commandId?: string } = { ...payload.context }
  if (ev.type === 'button') ctx.buttonId = ev.buttonId
  if (ev.type === 'panel') ctx.panelId = ev.panelId
  if (ev.type === 'command') ctx.commandId = ev.commandId

  // Handler return values are RESERVED — mutations go through relay.* APIs.
  const warnOnReturn = (value: unknown): void => {
    if (value !== undefined) {
      log('warn')('plugin handler return values are reserved and ignored — use relay.* APIs')
    }
  }

  try {
    const r = handler(ctx) as unknown
    if (r && typeof (r as PromiseLike<unknown>).then === 'function') {
      // Bound the async settle so a never-resolving promise can't hang the run
      // (the host's hard wall would kill the child, losing logs/toast).
      let timer: ReturnType<typeof setTimeout> | undefined
      let timedOut = false
      try {
        const settled = await Promise.race([
          Promise.resolve(r).catch((err) => {
            throw err
          }),
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => {
              timedOut = true
              resolve(undefined)
            }, ASYNC_TIMEOUT_MS)
          })
        ])
        if (timedOut) return finalize(`plugin handler did not finish within ${ASYNC_TIMEOUT_MS / 1000}s`)
        warnOnReturn(settled)
      } finally {
        // Always clear the race timer — including when the handler rejected, so
        // a dangling timeout can't keep the child's event loop alive.
        if (timer) clearTimeout(timer)
      }
    } else {
      warnOnReturn(r)
    }
  } catch (err) {
    return finalize(errorMessage(err))
  }

  return finalize()
}
