import type {
  RequestModel,
  RequestSettings,
  RequestSpec,
  ScriptRunResult,
  StoredCookie,
  TabModel,
  VariableDef,
  VariableScope
} from '@shared/types'
import { makeId } from '@shared/id'
import { useTabs } from '../store/tabs'
import { useCollections } from '../store/collections'
import { useEnvironments } from '../store/environments'
import { useSettings } from '../store/settings'
import { useResponse } from '../store/response'
import { useHistory } from '../store/history'
import { useConsole } from '../store/console'
import { useUi } from '../store/ui'
import { buildRequestSpec } from './request-spec'

/** Short, readable body preview for the console log. */
function consoleBodyPreview(body: RequestModel['body']): string | undefined {
  switch (body.type) {
    case 'raw':
      return body.text || undefined
    case 'graphql':
      return body.query || undefined
    case 'urlencoded':
      return body.items
        .filter((i) => i.enabled && i.key)
        .map((i) => `${i.key}=${i.value}`)
        .join('&')
    case 'formdata':
      return body.items
        .filter((i) => i.enabled && i.key)
        .map((i) => `${i.key}=${i.type === 'file' ? `<file ${i.fileName ?? ''}>` : i.value}`)
        .join('\n')
    case 'binary':
      return body.fileName ? `<binary ${body.fileName}>` : '<binary>'
    default:
      return undefined
  }
}

export function settingsToRequestSettings(): RequestSettings {
  const s = useSettings.getState().settings
  return {
    timeoutMs: s.requestTimeoutMs,
    followRedirects: s.followRedirects,
    maxRedirects: s.maxRedirects,
    rejectUnauthorized: s.rejectUnauthorized,
    // Global network config threaded to the engine (proxy bypass + per-host certs).
    proxy: s.proxy && s.proxy.enabled ? s.proxy : null,
    clientCerts: s.clientCerts ?? [],
    allowH2: s.http2 === true
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

export function persistVarUpdates(envUpdates: Record<string, string | null>, globalUpdates: Record<string, string | null>): void {
  const envStore = useEnvironments.getState()
  const active = envStore.activeEnv()
  if (active && Object.keys(envUpdates).length) {
    envStore.setEnvVars(active.id, applyVarUpdates(active.variables, envUpdates))
  }
  if (Object.keys(globalUpdates).length) {
    envStore.setGlobalVars(applyVarUpdates(envStore.globals.variables, globalUpdates))
  }
}

/** Hostname of a URL (lowercased), or '' if it can't be parsed. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** True if `cookieDomain` (dot-stripped) is `host` or a suffix of it. */
function cookieDomainMatches(host: string, cookieDomain: string): boolean {
  const d = cookieDomain.replace(/^\./, '').toLowerCase()
  if (!host || !d) return false
  return host === d || host.endsWith(`.${d}`)
}

/** Fetch the persistent jar and keep only cookies matching `url`'s host, for
 *  the pm.cookies (read) snapshot passed into a script run. */
export async function cookieSnapshotFor(url: string): Promise<StoredCookie[]> {
  const host = hostOf(url)
  if (!host) return []
  try {
    const all = await window.api.cookiesGet()
    return all.filter((c) => c && c.domain && cookieDomainMatches(host, c.domain))
  } catch {
    return []
  }
}

/** Apply a script's collection-variable + cookie mutations back to their stores. */
export function applyScriptSideEffects(savedRequestId: string | null, result: ScriptRunResult): void {
  if (result.collectionUpdates && Object.keys(result.collectionUpdates).length) {
    useCollections.getState().applyCollectionVarUpdates(savedRequestId, result.collectionUpdates)
  }
  const cu = result.cookieUpdates
  if (cu) {
    for (const c of cu.set ?? []) void window.api.cookiesSet(c)
    for (const r of cu.remove ?? []) void window.api.cookiesDelete(r)
  }
}

/** Merge a pre-request script's requestPatch into the working request. */
function applyRequestPatch(req: RequestModel, patch: ScriptRunResult['requestPatch']): RequestModel {
  if (!patch) return req
  return {
    ...req,
    url: patch.url ?? req.url,
    method: patch.method ?? req.method,
    headers: patch.headers ?? req.headers
  }
}

/**
 * Ordered pre-request script bodies for a request: ancestor collection/folder
 * scripts top-down (root first), then the request's own. Empty bodies dropped.
 */
function preScriptBodies(workingReq: RequestModel, savedRequestId: string | null): string[] {
  const out: string[] = []
  for (const a of useCollections.getState().ancestorScriptsFor(savedRequestId)) {
    if (a.preRequestScript?.trim()) out.push(a.preRequestScript)
  }
  if (workingReq.preRequestScript?.trim()) out.push(workingReq.preRequestScript)
  return out
}

/** Ordered test script bodies: ancestor scripts top-down, then the own one. */
function testScriptBodies(workingReq: RequestModel, savedRequestId: string | null): string[] {
  const out: string[] = []
  for (const a of useCollections.getState().ancestorScriptsFor(savedRequestId)) {
    if (a.testScript?.trim()) out.push(a.testScript)
  }
  if (workingReq.testScript?.trim()) out.push(workingReq.testScript)
  return out
}

/** Resolve a tab by id, defaulting to the active one (split-screen panes pass ids). */
function tabFor(tabId?: string): TabModel | null {
  const s = useTabs.getState()
  if (!tabId) return s.activeTab()
  return s.doc.tabs.find((t) => t.id === tabId) ?? null
}

/** Run a tab's request end-to-end (pre-request script → send → tests → history); defaults to the active tab. */
export async function sendActiveRequest(tabId?: string): Promise<void> {
  const tab = tabFor(tabId)
  if (!tab) return

  const collections = useCollections.getState()
  const envStore = useEnvironments.getState()
  const settings = settingsToRequestSettings()

  let workingReq: RequestModel = structuredClone(tab.request)

  // 1) pre-request scripts (P1): collection/folder scripts top-down, then own.
  for (const code of preScriptBodies(workingReq, tab.savedRequestId)) {
    try {
      const result = await window.api.runScript({
        phase: 'pre-request',
        code,
        request: workingReq,
        environment: envStore.envScope(),
        globals: envStore.globalScope(),
        collection: collections.collectionScopeFor(tab.savedRequestId),
        cookies: await cookieSnapshotFor(workingReq.url),
        url: workingReq.url
      })
      persistVarUpdates(result.environmentUpdates, result.globalUpdates)
      applyScriptSideEffects(tab.savedRequestId, result)
      // Pre-request scripts have no results pane — surface a failure so it isn't
      // silently dropped (e.g. a sandbox timeout that skipped an auth header).
      if (result.error) useUi.getState().showToast(`Pre-request скрипт: ${result.error}`, 'error')
      workingReq = applyRequestPatch(workingReq, result.requestPatch)
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

  // 3) send
  const requestId = makeId('rq')
  useResponse.getState().setLoading(tab.id, requestId)

  let spec: RequestSpec
  try {
    spec = buildRequestSpec(workingReq, scope, settings, inheritedAuth).spec
  } catch (err) {
    // Never leave the tab stuck on "loading" — surface a structured build error.
    const message = err instanceof Error ? err.message : String(err)
    useResponse.getState().setResult(tab.id, requestId, {
      ok: false,
      status: 0,
      statusText: '',
      headers: [],
      cookies: [],
      body: { contentType: '', isBinary: false, sizeBytes: 0 },
      timings: { startedAt: Date.now(), totalMs: 0 },
      redirects: [],
      finalUrl: workingReq.url,
      error: { kind: 'unknown', message: `Failed to build request: ${message}` }
    })
    return
  }

  const result = await window.api.sendRequest(spec, { requestId })

  // Log every completed send to the Console (Postman-style request log).
  useConsole.getState().add({
    method: spec.method,
    url: spec.url,
    status: result.status,
    ok: result.ok,
    timeMs: result.timings.totalMs,
    sizeBytes: result.body.sizeBytes,
    requestHeaders: spec.headers.filter((h) => h.enabled && h.key).map((h) => [h.key, h.value] as [string, string]),
    responseHeaders: result.headers,
    requestBody: consoleBodyPreview(spec.body),
    responseBody: result.body.text,
    error: result.error?.message
  })

  useResponse.getState().setResult(tab.id, requestId, result)

  // If a newer request superseded this tab while we awaited, stop here — don't add
  // a phantom history entry, mutate variables, or run tests for a hidden response.
  if (useResponse.getState().get(tab.id).requestId !== requestId) return

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

  // 5) test scripts (P1): collection/folder scripts top-down, then own. Results
  // (tests + logs) accumulate across all scripts; the last visualizer wins.
  const testBodies = testScriptBodies(workingReq, tab.savedRequestId)
  if (testBodies.length) {
    const allTests: ScriptRunResult['tests'] = []
    const allLogs: ScriptRunResult['logs'] = []
    let visualizer: ScriptRunResult['visualizer'] = null
    const cookies = await cookieSnapshotFor(workingReq.url)
    for (const code of testBodies) {
      try {
        const scriptRes = await window.api.runScript({
          phase: 'test',
          code,
          request: workingReq,
          response: result,
          environment: useEnvironments.getState().envScope(),
          globals: useEnvironments.getState().globalScope(),
          collection: collections.collectionScopeFor(tab.savedRequestId),
          cookies,
          url: workingReq.url
        })
        persistVarUpdates(scriptRes.environmentUpdates, scriptRes.globalUpdates)
        applyScriptSideEffects(tab.savedRequestId, scriptRes)
        allTests.push(...scriptRes.tests)
        allLogs.push(...scriptRes.logs)
        if (scriptRes.visualizer) visualizer = scriptRes.visualizer
      } catch (err) {
        console.error('test script failed', err)
      }
    }
    useResponse.getState().setTests(tab.id, requestId, allTests, allLogs, visualizer)
  } else {
    useResponse.getState().setTests(tab.id, requestId, [], [], null)
  }
}

export function cancelActiveRequest(tabId?: string): void {
  const tab = tabFor(tabId)
  if (!tab) return
  const resp = useResponse.getState().get(tab.id)
  if (resp.requestId) void window.api.cancelRequest(resp.requestId)
}

/** Variable scope for a tab (defaults to active) — used by hover-resolution + AI context. */
export function currentScope(tabId?: string): VariableScope {
  const tab = tabFor(tabId)
  const collections = useCollections.getState()
  const envStore = useEnvironments.getState()
  return {
    collection: collections.collectionScopeFor(tab?.savedRequestId ?? null),
    environment: envStore.envScope(),
    global: envStore.globalScope()
  }
}

/** Literal values of secret-flagged variables (collection + env + globals), to redact from AI context. */
export function currentSecretValues(tabId?: string): string[] {
  const envStore = useEnvironments.getState()
  const active = envStore.activeEnv()
  const tab = tabFor(tabId)
  const collectionSecrets = useCollections.getState().collectionSecretValues(tab?.savedRequestId ?? null)
  const envGlobalSecrets = [...(active?.variables ?? []), ...envStore.globals.variables]
    .filter((v) => v.secret && v.enabled)
    .map((v) => v.value)
  return [...envGlobalSecrets, ...collectionSecrets]
}
