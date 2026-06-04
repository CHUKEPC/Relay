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

/** Reactive variable scope for the active request (collection → env → global). */
export function useScope(): VariableScope {
  const env = useEnvironments((s) => s.env)
  const globals = useEnvironments((s) => s.globals)
  const collectionsDoc = useCollections((s) => s.doc)
  const savedId = useTabs((s) => s.doc.tabs.find((t) => t.id === s.doc.activeTabId)?.savedRequestId ?? null)
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
