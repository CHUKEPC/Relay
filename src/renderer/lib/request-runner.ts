import type { RequestModel, RequestSettings, VariableDef, VariableScope } from '@shared/types'
import { makeId } from '@shared/id'
import { useTabs } from '../store/tabs'
import { useCollections } from '../store/collections'
import { useEnvironments } from '../store/environments'
import { useSettings } from '../store/settings'
import { useResponse } from '../store/response'
import { useHistory } from '../store/history'
import { buildRequestSpec } from './request-spec'

function settingsToRequestSettings(): RequestSettings {
  const s = useSettings.getState().settings
  return {
    timeoutMs: s.requestTimeoutMs,
    followRedirects: s.followRedirects,
    maxRedirects: s.maxRedirects,
    rejectUnauthorized: s.rejectUnauthorized
  }
}

function applyVarUpdates(existing: VariableDef[], updates: Record<string, string | null>): VariableDef[] {
  const out = existing.map((v) => ({ ...v }))
  for (const [key, value] of Object.entries(updates)) {
    const idx = out.findIndex((v) => v.key === key)
    if (value === null) {
      if (idx >= 0) out.splice(idx, 1)
    } else if (idx >= 0) {
      out[idx].value = value
    } else {
      out.push({ key, value, enabled: true })
    }
  }
  return out
}

function persistVarUpdates(envUpdates: Record<string, string | null>, globalUpdates: Record<string, string | null>): void {
  const envStore = useEnvironments.getState()
  const active = envStore.activeEnv()
  if (active && Object.keys(envUpdates).length) {
    envStore.setEnvVars(active.id, applyVarUpdates(active.variables, envUpdates))
  }
  if (Object.keys(globalUpdates).length) {
    envStore.setGlobalVars(applyVarUpdates(envStore.globals.variables, globalUpdates))
  }
}

/** Run the active tab's request end-to-end: pre-request script → send → tests → history. */
export async function sendActiveRequest(): Promise<void> {
  const tabsStore = useTabs.getState()
  const tab = tabsStore.activeTab()
  if (!tab) return

  const collections = useCollections.getState()
  const envStore = useEnvironments.getState()
  const settings = settingsToRequestSettings()

  let workingReq: RequestModel = structuredClone(tab.request)

  // 1) pre-request script (P1)
  if (workingReq.preRequestScript?.trim()) {
    try {
      const result = await window.api.runScript({
        phase: 'pre-request',
        code: workingReq.preRequestScript,
        request: workingReq,
        environment: envStore.envScope(),
        globals: envStore.globalScope()
      })
      persistVarUpdates(result.environmentUpdates, result.globalUpdates)
      if (result.requestPatch) {
        workingReq = {
          ...workingReq,
          url: result.requestPatch.url ?? workingReq.url,
          method: result.requestPatch.method ?? workingReq.method,
          headers: result.requestPatch.headers ?? workingReq.headers
        }
      }
    } catch (err) {
      console.error('pre-request script failed', err)
    }
  }

  // 2) build the resolved spec (scopes recomputed post-script)
  const scope: VariableScope = {
    collection: collections.collectionScopeFor(tab.savedRequestId),
    environment: useEnvironments.getState().envScope(),
    global: useEnvironments.getState().globalScope()
  }
  const inheritedAuth = collections.inheritedAuthFor(tab.savedRequestId)
  const { spec } = buildRequestSpec(workingReq, scope, settings, inheritedAuth)

  // 3) send
  const requestId = makeId('rq')
  useResponse.getState().setLoading(tab.id, requestId)
  const result = await window.api.sendRequest(spec, { requestId })
  useResponse.getState().setResult(tab.id, result)

  // 4) history
  useHistory.getState().add(
    {
      id: makeId('hist'),
      method: spec.method,
      url: spec.url,
      status: result.status,
      ok: result.ok,
      timeMs: result.timings.totalMs,
      sizeBytes: result.body.sizeBytes,
      at: Date.now(),
      request: structuredClone(workingReq)
    },
    useSettings.getState().settings.maxHistory
  )

  // 5) test script (P1)
  if (workingReq.testScript?.trim()) {
    try {
      const scriptRes = await window.api.runScript({
        phase: 'test',
        code: workingReq.testScript,
        request: workingReq,
        response: result,
        environment: useEnvironments.getState().envScope(),
        globals: useEnvironments.getState().globalScope()
      })
      persistVarUpdates(scriptRes.environmentUpdates, scriptRes.globalUpdates)
      useResponse.getState().setTests(tab.id, scriptRes.tests, scriptRes.logs)
    } catch (err) {
      console.error('test script failed', err)
    }
  } else {
    useResponse.getState().setTests(tab.id, [], [])
  }
}

export function cancelActiveRequest(): void {
  const tab = useTabs.getState().activeTab()
  if (!tab) return
  const resp = useResponse.getState().get(tab.id)
  if (resp.requestId) void window.api.cancelRequest(resp.requestId)
}

/** Build the current variable scope for the active tab (used by hover-resolution + AI context). */
export function currentScope(): VariableScope {
  const tab = useTabs.getState().activeTab()
  const collections = useCollections.getState()
  const envStore = useEnvironments.getState()
  return {
    collection: collections.collectionScopeFor(tab?.savedRequestId ?? null),
    environment: envStore.envScope(),
    global: envStore.globalScope()
  }
}
