/**
 * AI IPC glue for the main process.
 *
 * Bridges the renderer's `ai:*` channels to the pure adapters in `./adapters`.
 * Secrets (safeStorage) are resolved here via injected `deps` and passed down
 * as plain strings; the adapters never touch electron or safeStorage, which
 * keeps them pure and testable. API keys are NEVER logged and NEVER returned to
 * the renderer.
 */
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import type { AiChatStart, ModelInfo, ProviderConfig } from '@shared/types'
import { IPC } from '@shared/ipc-contract'
import { listModels, streamChat, type ResolvedProvider } from './adapters'

export interface AiHandlerDeps {
  /** Decrypt a stored secret by its ref (apiKeyRef). Returns null if absent. */
  getSecret(ref: string): string | null
  /** Look up a provider config by id. Returns null if not configured. */
  getProvider(id: string): ProviderConfig | null
}

/**
 * Build the internal ResolvedProvider for a config, decrypting its key.
 * Returns null only when the provider config itself is missing.
 */
function resolveProvider(
  provider: ProviderConfig,
  deps: AiHandlerDeps
): ResolvedProvider {
  let apiKey: string | undefined
  if (provider.apiKeyRef) {
    apiKey = deps.getSecret(provider.apiKeyRef) ?? undefined
  }
  return {
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    apiKey,
    extraHeaders: provider.extraHeaders
  }
}

export function registerAiHandlers(ipcMain: IpcMain, deps: AiHandlerDeps): void {
  // Active streams keyed by streamId so `ai:cancel` can abort them.
  const controllers = new Map<string, AbortController>()

  /* ---- ai:chat — start a streaming chat ---- */
  ipcMain.handle(IPC.ai.chat, async (event: IpcMainInvokeEvent, payload: AiChatStart) => {
    const sender: WebContents = event.sender
    const channel = `${IPC.ai.event}:${payload.streamId}`
    const emit = (evt: unknown): void => {
      // The sender may be gone if the window closed mid-stream.
      if (!sender.isDestroyed()) sender.send(channel, evt)
    }

    const provider = deps.getProvider(payload.providerId)
    if (!provider) {
      emit({ type: 'error', error: 'Provider not configured' })
      return
    }

    const resolved = resolveProvider(provider, deps)
    const controller = new AbortController()
    controllers.set(payload.streamId, controller)

    let sawTerminal = false
    try {
      const gen = streamChat(resolved, payload.model, payload.messages, {
        tools: payload.tools,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
        signal: controller.signal
      })
      for await (const evt of gen) {
        emit(evt)
        if (evt.type === 'done' || evt.type === 'error') sawTerminal = true
      }
      // The generator can return without a terminal event when aborted; only
      // surface a terminal 'done' if we were NOT cancelled by the user.
      if (!sawTerminal && !controller.signal.aborted) {
        emit({ type: 'done' })
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        // Never include secrets; only the error message is forwarded.
        emit({ type: 'error', error: (err as Error)?.message || 'AI request failed' })
      }
    } finally {
      // Only remove our own controller — if the streamId was reused, a newer
      // chat may have replaced the map entry and must stay cancellable.
      if (controllers.get(payload.streamId) === controller) controllers.delete(payload.streamId)
    }
  })

  /* ---- ai:cancel — abort an in-flight stream ---- */
  ipcMain.on(IPC.ai.cancel, (_event: IpcMainEvent, streamId: string) => {
    const controller = controllers.get(streamId)
    if (controller) {
      controller.abort()
      controllers.delete(streamId)
    }
  })

  /* ---- ai:listModels — dynamic model list (best-effort) ---- */
  ipcMain.handle(
    IPC.ai.listModels,
    async (_event: IpcMainInvokeEvent, providerId: string): Promise<ModelInfo[]> => {
      try {
        const provider = deps.getProvider(providerId)
        if (!provider) return []
        const resolved = resolveProvider(provider, deps)
        return await listModels(resolved)
      } catch {
        return []
      }
    }
  )
}
