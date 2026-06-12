import { useMemo } from 'react'
import type { RequestModel, TabModel, VariableScope } from '@shared/types'
import { useTabs } from '../store/tabs'
import { useEnvironments } from '../store/environments'
import { useCollections } from '../store/collections'

export function useActiveTab(): TabModel | null {
  return useTabs((s) => s.doc.tabs.find((t) => t.id === s.doc.activeTabId) ?? null)
}

export function useActiveRequest(): RequestModel | null {
  return useTabs((s) => s.doc.tabs.find((t) => t.id === s.doc.activeTabId)?.request ?? null)
}

/** Tab by id, or the active tab when no id is given (per-tab rendering support). */
export function useTab(tabId?: string): TabModel | null {
  return useTabs((s) => {
    const id = tabId ?? s.doc.activeTabId
    return s.doc.tabs.find((t) => t.id === id) ?? null
  })
}

/** Reactive variable scope for a request (collection → env → global).
 *  Defaults to the active tab; pass a tabId to scope a specific tab. */
export function useScope(tabId?: string): VariableScope {
  const env = useEnvironments((s) => s.env)
  const globals = useEnvironments((s) => s.globals)
  const collectionsDoc = useCollections((s) => s.doc)
  const savedId = useTabs((s) => {
    const id = tabId ?? s.doc.activeTabId
    return s.doc.tabs.find((t) => t.id === id)?.savedRequestId ?? null
  })
  return useMemo(
    () => ({
      collection: useCollections.getState().collectionScopeFor(savedId),
      environment: useEnvironments.getState().envScope(),
      global: useEnvironments.getState().globalScope()
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [env, globals, collectionsDoc, savedId]
  )
}
