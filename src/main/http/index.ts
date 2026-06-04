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

import { runRequest } from './engine'

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
 */
export function registerHttpHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC.request.send,
    async (_event: IpcMainInvokeEvent, spec: RequestSpec, opts: RunOptions): Promise<ResponseResult> => {
      const controller = new AbortController()
      // Last writer wins if a requestId is reused; abort the stale transfer.
      const previous = inFlight.get(opts.requestId)
      if (previous) previous.abort()
      inFlight.set(opts.requestId, controller)

      try {
        return await runRequest(spec, opts, controller.signal)
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
