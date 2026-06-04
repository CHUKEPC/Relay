import { create } from 'zustand'
import type { AiContextSnapshot, ChatMessage, ProviderConfig, ProvidersDoc, ToolCall } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { makeId } from '@shared/id'
import { emptyProviders } from './defaults'
import { persist } from './persist'
import { useSettings } from './settings'
import { buildContextBlock, SYSTEM_PROMPT } from '../lib/ai-context'
import { TOOL_SPECS, executeTool, isMutating, describeToolCall } from '../lib/ai-tools'

export interface PendingConfirm {
  title: string
  detail: string
  resolve: (approved: boolean) => void
}

export interface UiChatMessage {
  id: string
  role: 'user' | 'assistant'
  /** display content (may include tool-status decorations) */
  content: string
  /** clean text for replay to the provider (no UI decorations); falls back to `content` */
  apiContent?: string
  context?: { label: string; icon: string }
  streaming?: boolean
  error?: boolean
}

interface AiState {
  providers: ProvidersDoc
  thread: UiChatMessage[]
  isStreaming: boolean
  currentStreamId: string | null
  pendingConfirm: PendingConfirm | null
  /** generation token; bumped by cancel()/clearThread()/new send() to invalidate an in-flight loop */
  runGen: number
  confirmTool: (approved: boolean) => void
  hydrateProviders: (doc: ProvidersDoc) => void
  setActiveProvider: (id: string) => void
  setProviderModel: (id: string, model: string) => void
  addProvider: (p: ProviderConfig) => void
  updateProvider: (id: string, patch: Partial<ProviderConfig>) => void
  removeProvider: (id: string) => void
  setProviderKey: (id: string, key: string) => Promise<void>
  clearProviderKey: (id: string) => Promise<void>
  activeProvider: () => ProviderConfig | null
  isConnected: () => boolean
  clearThread: () => void
  send: (text: string, snapshot?: AiContextSnapshot, ctxLabel?: { label: string; icon: string }) => Promise<void>
  cancel: () => void
}

function commitProviders(doc: ProvidersDoc) {
  persist('providers', doc)
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s || '{}')
  } catch {
    return {}
  }
}

export const useAi = create<AiState>((set, get) => ({
  providers: emptyProviders(),
  thread: [],
  isStreaming: false,
  currentStreamId: null,
  pendingConfirm: null,
  runGen: 0,

  confirmTool: (approved) => {
    const pc = get().pendingConfirm
    if (pc) {
      pc.resolve(approved)
      set({ pendingConfirm: null })
    }
  },

  hydrateProviders: (doc) => set({ providers: { ...doc, version: STORAGE_VERSION } }),

  setActiveProvider: (id) => {
    const providers = { ...get().providers, activeProviderId: id }
    set({ providers })
    commitProviders(providers)
  },

  setProviderModel: (id, model) => {
    // Only change the provider's default model — do NOT hijack the active provider
    // (callers that also want to activate it call setActiveProvider explicitly).
    const list = get().providers.providers.map((p) => (p.id === id ? { ...p, defaultModel: model } : p))
    const providers = { ...get().providers, providers: list }
    set({ providers })
    commitProviders(providers)
  },

  addProvider: (p) => {
    const providers = { ...get().providers, providers: [...get().providers.providers, p] }
    set({ providers })
    commitProviders(providers)
  },

  updateProvider: (id, patch) => {
    const list = get().providers.providers.map((p) => (p.id === id ? { ...p, ...patch } : p))
    const providers = { ...get().providers, providers: list }
    set({ providers })
    commitProviders(providers)
  },

  removeProvider: (id) => {
    const list = get().providers.providers.filter((p) => p.id !== id)
    const activeProviderId = get().providers.activeProviderId === id ? (list[0]?.id ?? null) : get().providers.activeProviderId
    const providers = { ...get().providers, providers: list, activeProviderId }
    set({ providers })
    commitProviders(providers)
  },

  setProviderKey: async (id, key) => {
    const ref = `provider:${id}`
    await window.api.secretsSet(ref, key)
    get().updateProvider(id, { apiKeyRef: ref, hasKey: true })
  },

  clearProviderKey: async (id) => {
    const ref = `provider:${id}`
    await window.api.secretsDelete(ref)
    get().updateProvider(id, { hasKey: false, apiKeyRef: undefined })
  },

  activeProvider: () => {
    const { providers } = get()
    return providers.providers.find((p) => p.id === providers.activeProviderId) ?? providers.providers[0] ?? null
  },

  isConnected: () => !!get().activeProvider()?.hasKey,

  clearThread: () => {
    const id = get().currentStreamId
    if (id) void window.api.aiCancel(id)
    get().pendingConfirm?.resolve(false)
    set({ thread: [], isStreaming: false, currentStreamId: null, pendingConfirm: null, runGen: get().runGen + 1 })
  },

  send: async (text, snapshot, ctxLabel) => {
    const provider = get().activeProvider()
    if (!provider) return

    // A new run invalidates any in-flight loop; `cancelled()` lets the loop bail
    // out after cancel()/clearThread()/another send().
    const runGen = get().runGen + 1
    set({ runGen })
    const cancelled = (): boolean => get().runGen !== runGen
    // Unblock a confirm dialog left open by a previous run so its send() coroutine
    // isn't orphaned forever.
    get().pendingConfirm?.resolve(false)
    if (get().pendingConfirm) set({ pendingConfirm: null })

    const userMsg: UiChatMessage = { id: makeId('msg'), role: 'user', content: text, context: ctxLabel }
    set({ thread: [...get().thread, userMsg] })

    const priorTurns: ChatMessage[] = get()
      .thread.filter((m) => !m.streaming && (m.apiContent ?? m.content) && m.id !== userMsg.id)
      .map((m) => ({ role: m.role, content: m.apiContent ?? m.content }))
    const systemContent = snapshot ? `${SYSTEM_PROMPT}\n\n${buildContextBlock(snapshot)}` : SYSTEM_PROMPT
    const providerMessages: ChatMessage[] = [
      { role: 'system', content: systemContent },
      ...priorTurns,
      { role: 'user', content: text }
    ]

    const autoApply = useSettings.getState().settings.autoApplyAiTools
    set({ isStreaming: true })

    try {
      // Tool-calling loop: stream a turn; if the model requested tools, execute
      // them (with confirmation for mutating ones) and loop for the final answer.
      for (let iter = 0; iter < 5; iter++) {
        if (cancelled()) break
        const assistantId = makeId('msg')
        set((s) => ({ thread: [...s.thread, { id: assistantId, role: 'assistant', content: '', streaming: true }] }))
        const patchAssistant = (fn: (m: UiChatMessage) => UiChatMessage) =>
          set((s) => ({ thread: s.thread.map((m) => (m.id === assistantId ? fn(m) : m)) }))

        const streamId = makeId('stream')
        set({ currentStreamId: streamId })
        let collectedText = ''
        const toolCalls: ToolCall[] = []
        let errored = false

        const unsubscribe = window.api.onAiStream(streamId, (evt) => {
          if (evt.type === 'text') {
            collectedText += evt.text
            patchAssistant((m) => ({ ...m, content: m.content + evt.text }))
          } else if (evt.type === 'tool_call') {
            toolCalls.push(evt.call)
          } else if (evt.type === 'error') {
            errored = true
            patchAssistant((m) => ({ ...m, content: m.content || `⚠ ${evt.error}`, error: true, streaming: false }))
          }
        })

        try {
          await window.api.aiChat({ streamId, providerId: provider.id, model: provider.defaultModel, messages: providerMessages, tools: TOOL_SPECS })
        } catch (err) {
          errored = true
          patchAssistant((m) => ({ ...m, content: m.content || `⚠ ${(err as Error).message}`, error: true, streaming: false }))
        } finally {
          unsubscribe()
        }
        // Persist the clean streamed text (no UI decorations) for cross-turn replay.
        patchAssistant((m) => ({ ...m, streaming: false, apiContent: collectedText }))

        // Stopped by the user (or superseded) — do not start another tool round.
        if (cancelled()) break
        if (errored || toolCalls.length === 0) break

        providerMessages.push({ role: 'assistant', content: collectedText, toolCalls })
        for (const call of toolCalls) {
          let approved = true
          if (isMutating(call.name) && !autoApply) {
            const d = describeToolCall(call.name, safeParse(call.arguments))
            approved = await new Promise<boolean>((resolve) => set({ pendingConfirm: { title: d.title, detail: d.detail, resolve } }))
          }
          if (cancelled()) break
          const result = approved ? await executeTool(call.name, call.arguments) : 'User rejected this action.'
          providerMessages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result })
          patchAssistant((m) => ({ ...m, content: `${m.content}${m.content ? '\n\n' : ''}_🔧 ${call.name}: ${approved ? 'выполнено' : 'отклонено'}_` }))
        }
      }
    } finally {
      // Only clear shared streaming state if this run is still current — otherwise
      // a newer run owns it and must not be stomped.
      if (!cancelled()) {
        set({ isStreaming: false, currentStreamId: null })
        set((s) => ({ thread: s.thread.map((m) => (m.streaming ? { ...m, streaming: false } : m)) }))
      }
    }
  },

  cancel: () => {
    const id = get().currentStreamId
    if (id) void window.api.aiCancel(id)
    get().pendingConfirm?.resolve(false)
    set({ isStreaming: false, currentStreamId: null, pendingConfirm: null, runGen: get().runGen + 1 })
    set((s) => ({ thread: s.thread.map((m) => (m.streaming ? { ...m, streaming: false } : m)) }))
  }
}))
