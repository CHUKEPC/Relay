import { create } from 'zustand'
import type {
  PluginButtonContribution,
  PluginButtonLocation,
  PluginCommandContribution,
  PluginEventContext,
  PluginInfo,
  PluginRunResult
} from '@shared/types'
import { requestSnapshotForPlugin, responseSnapshotForPlugin } from '@shared/plugin-context'
import { useUi } from './ui'
import { useTabs } from './tabs'
import { useResponse } from './response'

/** A contributed button paired with its source plugin (for toolbar rendering). */
export interface PluginToolbarButton {
  pluginId: string
  pluginName: string
  button: PluginButtonContribution
}

interface PluginsState {
  plugins: PluginInfo[]
  loaded: boolean
  /** in-flight button invocations, keyed `${pluginId}:${buttonId}` */
  busy: Record<string, boolean>
  /** Load the list and subscribe to hot-reload/hook broadcasts (idempotent). */
  init: () => Promise<void>
  refresh: () => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  /** Update non-secret config locally and persist to main (debounced per plugin). */
  setConfig: (id: string, config: Record<string, string>) => void
  /** Set/clear a secret config value (stored in safeStorage; '' clears). */
  setSecret: (id: string, key: string, value: string) => Promise<void>
  /** Narrow a broad net grant to a host allowlist ([] = no restriction). */
  setNetAllowlist: (id: string, hosts: string[]) => Promise<void>
  invokeButton: (pluginId: string, buttonId: string, context: PluginEventContext) => Promise<void>
  /** Invoke a button using the active tab's request/response as context. */
  invokeButtonFromActiveTab: (pluginId: string, buttonId: string) => Promise<void>
  /** Run a panel handler; returns the result (caller renders panelHtml). */
  invokePanel: (pluginId: string, panelId: string, context: PluginEventContext) => Promise<PluginRunResult>
  /** Forward an interactive panel's postMessage; returns the new panelHtml. */
  panelMessage: (pluginId: string, panelId: string, message: unknown, context: PluginEventContext) => Promise<PluginRunResult>
  /** Run a contributed command (from the palette) with active-tab context. */
  invokeCommandFromActiveTab: (pluginId: string, commandId: string) => Promise<void>
  /** Returns 'exists' when the sample folder is already there and force=false. */
  installSample: (force?: boolean) => Promise<'ok' | 'exists' | 'error'>
  /** Install a plugin from a user-picked .zip. */
  installFromZip: () => Promise<void>
  deletePlugin: (id: string) => Promise<void>
}

/** A contributed command paired with its source plugin (for the palette). */
export interface PluginPaletteCommand {
  pluginId: string
  pluginName: string
  command: PluginCommandContribution
}

/** Enabled plugins' palette commands (pure — usable in useMemo). */
export function collectCommands(plugins: PluginInfo[]): PluginPaletteCommand[] {
  const out: PluginPaletteCommand[] = []
  for (const p of plugins) {
    if (!p.enabled || p.error) continue
    for (const command of p.manifest.contributes.commands ?? []) {
      out.push({ pluginId: p.manifest.id, pluginName: p.manifest.name, command })
    }
  }
  return out
}

/** Enabled plugins' buttons for a given location (pure — usable in useMemo). */
export function collectButtons(plugins: PluginInfo[], location: PluginButtonLocation): PluginToolbarButton[] {
  const out: PluginToolbarButton[] = []
  for (const p of plugins) {
    if (!p.enabled || p.error) continue
    for (const button of p.manifest.contributes.buttons ?? []) {
      if (button.location === location) {
        out.push({ pluginId: p.manifest.id, pluginName: p.manifest.name, button })
      }
    }
  }
  return out
}

/** Overlay still-unsaved config edits onto a fresh server list, so a list
 *  returned by setEnabled/setSecret/etc. can't revert config the user is typing. */
function overlayPending(list: PluginInfo[]): PluginInfo[] {
  return list.map((p) => {
    const pending = pendingConfig.get(p.manifest.id)
    return pending ? { ...p, config: pending } : p
  })
}

/** Build a plugin event context from the active tab's request + its response. */
function activeTabContext(): PluginEventContext {
  const tab = useTabs.getState().activeTab()
  const req = tab?.request
  const resp = tab ? useResponse.getState().byTab[tab.id]?.result : undefined
  return {
    request: req ? requestSnapshotForPlugin(req.method, req.url, req.headers) : undefined,
    response: resp ? responseSnapshotForPlugin(resp) : undefined
  }
}

let subscribed = false
const configTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Config edits not yet persisted to main (debounce in flight). refresh()
 *  overlays these so a broadcast-triggered refetch can't revert typing. */
const pendingConfig = new Map<string, Record<string, string>>()

export const usePlugins = create<PluginsState>((set, get) => ({
  plugins: [],
  loaded: false,
  busy: {},

  init: async () => {
    if (!subscribed) {
      subscribed = true
      // Flush any debounced config edit before the window goes away, so the
      // last keystrokes aren't lost (mirrors persist.ts's beforeunload flush).
      window.addEventListener('beforeunload', () => {
        for (const [id, timer] of configTimers) {
          clearTimeout(timer)
          const cfg = pendingConfig.get(id)
          if (cfg) void window.api.pluginsSetConfig(id, cfg)
        }
        configTimers.clear()
        pendingConfig.clear()
      })
      window.api.onPluginsEvent((event) => {
        if (event.type === 'changed') {
          void get().refresh()
        } else if (event.type === 'lastRun') {
          // Fine-grained merge — no refetch, no risk of reverting config edits.
          set((s) => ({
            plugins: s.plugins.map((p) =>
              p.manifest.id === event.pluginId ? { ...p, lastRun: event.lastRun } : p
            )
          }))
        } else if (event.type === 'toast') {
          useUi.getState().showToast(event.message, event.kind)
        }
      })
    }
    await get().refresh()
  },

  refresh: async () => {
    try {
      // overlayPending keeps config the user is still typing (persist is
      // debounced) over main's stale persisted snapshot.
      const plugins = overlayPending(await window.api.pluginsList())
      set({ plugins, loaded: true })
    } catch (err) {
      console.error('[plugins] list failed:', err)
      set({ loaded: true })
    }
  },

  setEnabled: async (id, enabled) => {
    try {
      const plugins = overlayPending(await window.api.pluginsSetEnabled(id, enabled))
      set({ plugins })
    } catch (err) {
      useUi.getState().showToast('Не удалось переключить плагин', 'error')
      console.error('[plugins] setEnabled failed:', err)
    }
  },

  setConfig: (id, config) => {
    set((s) => ({
      plugins: s.plugins.map((p) => (p.manifest.id === id ? { ...p, config } : p))
    }))
    pendingConfig.set(id, config)
    const existing = configTimers.get(id)
    if (existing) clearTimeout(existing)
    configTimers.set(
      id,
      setTimeout(() => {
        configTimers.delete(id)
        pendingConfig.delete(id)
        void window.api.pluginsSetConfig(id, config).catch((err) => {
          console.error('[plugins] setConfig failed:', err)
        })
      }, 400)
    )
  },

  setSecret: async (id, key, value) => {
    try {
      const plugins = overlayPending(await window.api.pluginsSetSecret(id, key, value))
      set({ plugins })
    } catch (err) {
      useUi.getState().showToast('Не удалось сохранить секрет', 'error')
      console.error('[plugins] setSecret failed:', err)
    }
  },

  setNetAllowlist: async (id, hosts) => {
    try {
      const plugins = overlayPending(await window.api.pluginsSetNetAllowlist(id, hosts))
      set({ plugins })
    } catch (err) {
      useUi.getState().showToast('Не удалось обновить список хостов', 'error')
      console.error('[plugins] setNetAllowlist failed:', err)
    }
  },

  invokeButton: async (pluginId, buttonId, context) => {
    const key = `${pluginId}:${buttonId}`
    if (get().busy[key]) return
    set((s) => ({ busy: { ...s.busy, [key]: true } }))
    // Every plugin-originated toast is attributed — trusted chrome, not the
    // plugin, says who is talking.
    const name = get().plugins.find((p) => p.manifest.id === pluginId)?.manifest.name ?? pluginId
    try {
      const result = await window.api.pluginsInvokeButton(pluginId, buttonId, context)
      if (result.toast) useUi.getState().showToast(`Плагин ${name}: ${result.toast.message}`, result.toast.kind)
      else if (result.error) useUi.getState().showToast(`Плагин ${name}: ${result.error}`, 'error')
      else useUi.getState().showToast(`Плагин ${name}: готово`)
      for (const line of result.logs) {
        // Plugin console output lands in devtools for plugin authors.
        console.log(`[plugin:${pluginId}]`, line.message)
      }
    } catch (err) {
      useUi.getState().showToast(`Плагин ${name}: ошибка вызова`, 'error')
      console.error('[plugins] invoke failed:', err)
    } finally {
      set((s) => {
        const busy = { ...s.busy }
        delete busy[key]
        return { busy }
      })
    }
  },

  invokeButtonFromActiveTab: async (pluginId, buttonId) => {
    await get().invokeButton(pluginId, buttonId, activeTabContext())
  },

  invokeCommandFromActiveTab: async (pluginId, commandId) => {
    const name = get().plugins.find((p) => p.manifest.id === pluginId)?.manifest.name ?? pluginId
    try {
      const result = await window.api.pluginsInvokeCommand(pluginId, commandId, activeTabContext())
      if (result.toast) useUi.getState().showToast(`Плагин ${name}: ${result.toast.message}`, result.toast.kind)
      else if (result.error) useUi.getState().showToast(`Плагин ${name}: ${result.error}`, 'error')
      for (const line of result.logs) console.log(`[plugin:${pluginId}]`, line.message)
    } catch (err) {
      useUi.getState().showToast(`Плагин ${name}: ошибка вызова`, 'error')
      console.error('[plugins] invokeCommand failed:', err)
    }
  },

  invokePanel: async (pluginId, panelId, context) => {
    try {
      return await window.api.pluginsInvokePanel(pluginId, panelId, context)
    } catch (err) {
      console.error('[plugins] invokePanel failed:', err)
      return { logs: [], error: 'Ошибка вызова панели' }
    }
  },

  panelMessage: async (pluginId, panelId, message, context) => {
    try {
      return await window.api.pluginsPanelMessage(pluginId, panelId, message, context)
    } catch (err) {
      console.error('[plugins] panelMessage failed:', err)
      return { logs: [], error: 'Ошибка панели' }
    }
  },

  installSample: async (force = false) => {
    try {
      const { plugins, existed } = await window.api.pluginsInstallSample(force)
      set({ plugins: overlayPending(plugins) })
      if (existed) return 'exists'
      useUi.getState().showToast('Пример плагина установлен')
      return 'ok'
    } catch (err) {
      useUi.getState().showToast('Не удалось установить пример', 'error')
      console.error('[plugins] installSample failed:', err)
      return 'error'
    }
  },

  installFromZip: async () => {
    try {
      const res = await window.api.pluginsInstallZip()
      if (!res) return // cancelled
      set({ plugins: overlayPending(res.plugins) })
      useUi.getState().showToast(`Плагин «${res.id}» установлен — включите его в списке, чтобы выдать разрешения`)
    } catch (err) {
      useUi.getState().showToast(`Не удалось установить: ${(err as Error).message}`, 'error')
      console.error('[plugins] installFromZip failed:', err)
    }
  },

  deletePlugin: async (id) => {
    // Kill any in-flight config debounce: its late flush would resurrect a
    // state entry for the just-purged plugin.
    const timer = configTimers.get(id)
    if (timer) clearTimeout(timer)
    configTimers.delete(id)
    pendingConfig.delete(id)
    try {
      const plugins = overlayPending(await window.api.pluginsDelete(id))
      set({ plugins })
      useUi.getState().showToast('Плагин удалён')
    } catch (err) {
      useUi.getState().showToast('Не удалось удалить плагин', 'error')
      console.error('[plugins] delete failed:', err)
    }
  }
}))
