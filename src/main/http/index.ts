/**
 * IPC glue for the HTTP engine. This module may touch electron types; the
 * engine itself (`./engine`) stays pure and Node-only so it remains unit
 * testable without an Electron runtime.
 *
 * Wiring (from `src/main/index.ts`):
 *
 *   import { app } from 'electron'
 *   import { registerHttpHandlers } from './http'
 *   app.whenReady().then(() => registerHttpHandlers(ipcMain))
 */
import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import { IPC } from '@shared/ipc-contract'
import type { RequestSpec, ResponseResult, RunOptions } from '@shared/types'

import { runRequest, type CookieJarBridge } from './engine'

/**
 * Turn `proxy.mode === 'system'` into a concrete proxy for this URL.
 *
 * Chromium already knows the machine's proxy configuration — including PAC
 * scripts and WPAD — so the answer comes from the session resolver rather than
 * from re-reading OS settings. The engine stays free of Electron imports: by
 * the time it runs, a system proxy looks exactly like a custom one.
 */
async function resolveSystemProxy(spec: RequestSpec): Promise<RequestSpec> {
  const proxy = spec.settings.proxy
  if (!proxy || proxy.mode !== 'system') return spec
  try {
    const { session } = await import('electron')
    const resolved = await session.defaultSession.resolveProxy(spec.url)
    // "DIRECT" | "PROXY host:port" | "PROXY a:1;PROXY b:2" | "SOCKS5 host:port"
    const first = String(resolved || 'DIRECT').split(';')[0].trim()
    const [kind, address] = first.split(/s+/)
    if (!address || /^direct$/i.test(kind)) {
      return { ...spec, settings: { ...spec.settings, proxy: { ...proxy, mode: 'off', enabled: false } } }
    }
    const scheme = /^socks/i.test(kind) ? (/^socks4/i.test(kind) ? 'socks4' : 'socks5') : 'http'
    return { ...spec, settings: { ...spec.settings, proxy: { ...proxy, enabled: true, url: `${scheme}://${address}` } } }
  } catch (err) {
    console.error('[http] system proxy resolution failed:', (err as Error).message)
    return { ...spec, settings: { ...spec.settings, proxy: { ...proxy, mode: 'off', enabled: false } } }
  }
}

/**
 * In-flight requests keyed by `RunOptions.requestId`. Each entry owns the
 * AbortController whose signal is threaded into `runRequest`, so `request:cancel`
 * can abort the exact transfer.
 */
const inFlight = new Map<string, AbortController>()

/**
 * Register the `request:send` and `request:cancel` handlers.
 *
 * Idempotent-ish: callers should invoke this once during app startup. The
 * handlers create/track an AbortController per requestId and always clean the
 * map entry on completion (success or failure).
 *
 * `onResponse` is an optional fire-and-forget observer (the plugin `response`
 * lifecycle hook) — it must never delay or fail the response path.
 *
 * `onRequest` is an optional pre-send transform (the plugin `request` hook) —
 * it may return a patched spec; failures fall back to the original spec. The
 * abort signal lets it stop running hooks when the user cancels the request.
 */
export function registerHttpHandlers(
  ipcMain: IpcMain,
  cookieJar?: CookieJarBridge,
  onResponse?: (spec: RequestSpec, result: ResponseResult) => void,
  onRequest?: (spec: RequestSpec, signal: AbortSignal) => Promise<RequestSpec>
): void {
  ipcMain.handle(
    IPC.request.send,
    async (_event: IpcMainInvokeEvent, spec: RequestSpec, opts: RunOptions): Promise<ResponseResult> => {
      const controller = new AbortController()
      // Last writer wins if a requestId is reused; abort the stale transfer.
      const previous = inFlight.get(opts.requestId)
      if (previous) previous.abort()
      inFlight.set(opts.requestId, controller)

      try {
        // Pre-request plugin hooks may patch the resolved spec before send.
        let finalSpec = spec
        if (onRequest) {
          try {
            finalSpec = await onRequest(spec, controller.signal)
          } catch (err) {
            console.error('[http] onRequest transform failed:', err)
          }
        }
        finalSpec = await resolveSystemProxy(finalSpec)
        const result = await runRequest(finalSpec, opts, controller.signal, cookieJar)
        if (onResponse) {
          try {
            onResponse(finalSpec, result)
          } catch (err) {
            console.error('[http] onResponse observer failed:', err)
          }
        }
        return result
      } finally {
        // Only delete if we are still the owner (a reused id may have replaced us).
        if (inFlight.get(opts.requestId) === controller) {
          inFlight.delete(opts.requestId)
        }
      }
    }
  )

  ipcMain.handle(IPC.request.cancel, async (_event: IpcMainInvokeEvent, requestId: string): Promise<void> => {
    const controller = inFlight.get(requestId)
    if (controller) {
      controller.abort()
      inFlight.delete(requestId)
    }
  })
}

/**
 * Abort every in-flight request and clear the registry. Call on window close /
 * app quit to avoid dangling transfers.
 */
export function abortAllRequests(): void {
  for (const controller of inFlight.values()) controller.abort()
  inFlight.clear()
}
