import { create } from 'zustand'
import type { CollectionNode, RequestModel, VariableScope } from '@shared/types'
import { makeId } from '@shared/id'
import { parseCsv } from '@shared/csv'
import { buildRequestSpec } from '../lib/request-spec'
import {
  settingsToRequestSettings,
  persistVarUpdates,
  cookieSnapshotFor,
  applyScriptSideEffects
} from '../lib/request-runner'
import { useCollections } from './collections'
import { useEnvironments } from './environments'
import { useUi } from './ui'
import { tr } from '../lib/i18n'

export interface RequestRunResult {
  id: string
  name: string
  method: string
  status: number
  ok: boolean
  timeMs: number
  tests: { name: string; passed: boolean; error?: string }[]
  error?: string
}

export interface IterationResult {
  index: number
  requests: RequestRunResult[]
}

/** One line of the run list: a saved request, in the order it will be sent. */
export interface RunItem {
  /** saved request id (same value as its node id) */
  id: string
  name: string
  method: string
  /** breadcrumb of the folders above it */
  path: string
  enabled: boolean
}

/** A collection or folder the run list can be filled from. */
export interface RunTarget {
  id: string
  name: string
  /** nesting depth, for the indent in the picker */
  depth: number
  requests: number
}

interface RunnerState {
  open: boolean
  targetId: string | null
  targetName: string
  /** the run list itself — ticked entries run, in this order */
  items: RunItem[]
  iterations: number
  delayMs: number
  stopOnFailure: boolean
  dataRows: Record<string, string>[]
  dataFileName: string | null
  dataError: string | null
  running: boolean
  current: { iter: number; total: number; reqName: string } | null
  results: IterationResult[]
  openFor: (node: CollectionNode) => void
  /** Open with every request of the workspace listed, nothing ticked. */
  openPicker: () => void
  setTarget: (nodeId: string | null) => void
  targets: () => RunTarget[]
  toggleItem: (id: string) => void
  setAllItems: (enabled: boolean) => void
  moveItem: (id: string, dir: -1 | 1) => void
  close: () => void
  setIterations: (n: number) => void
  setDelay: (n: number) => void
  setStopOnFailure: (v: boolean) => void
  loadDataFile: () => Promise<void>
  clearData: () => void
  run: () => Promise<void>
  cancel: () => void
  exportReport: () => Promise<void>
}

/** Cancellation state kept outside the store (not reactive). */
let aborted = false
let inFlightRequestId: string | null = null

/** Collect request nodes under a collection/folder in document (depth-first) order. */
function flattenRequests(node: CollectionNode): { id: string; request: RequestModel }[] {
  const out: { id: string; request: RequestModel }[] = []
  const walk = (n: CollectionNode): void => {
    if (n.type === 'request') {
      out.push({ id: n.request.id, request: n.request })
    } else {
      for (const c of n.children) walk(c)
    }
  }
  walk(node)
  return out
}

/** Build the run list from a node (or from the whole workspace when null). */
function itemsOf(node: CollectionNode | null, enabled: boolean): RunItem[] {
  const roots: CollectionNode[] = node ? [node] : (useCollections.getState().doc.collections as CollectionNode[])
  const out: RunItem[] = []
  const walk = (n: CollectionNode, trail: string[]): void => {
    if (n.type === 'request') {
      out.push({ id: n.request.id, name: n.request.name, method: n.request.method, path: trail.join(' / '), enabled })
      return
    }
    for (const child of n.children) walk(child, [...trail, n.name])
  }
  for (const root of roots) walk(root, [])
  return out
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const useRunner = create<RunnerState>((set, get) => ({
  open: false,
  targetId: null,
  targetName: '',
  items: [],
  iterations: 1,
  delayMs: 0,
  stopOnFailure: false,
  dataRows: [],
  dataFileName: null,
  dataError: null,
  running: false,
  current: null,
  results: [],

  openFor: (node) =>
    set({
      open: true,
      targetId: node.id,
      targetName: node.type === 'request' ? node.request.name : node.name,
      items: itemsOf(node, true),
      results: [],
      current: null,
      dataError: null
    }),

  openPicker: () =>
    set({
      open: true,
      targetId: null,
      targetName: tr('Все коллекции'),
      // Nothing ticked: the point of this entry is picking a handful by hand.
      items: itemsOf(null, false),
      results: [],
      current: null,
      dataError: null
    }),

  setTarget: (nodeId) => {
    if (!nodeId) {
      set({ targetId: null, targetName: tr('Все коллекции'), items: itemsOf(null, false), results: [], dataError: null })
      return
    }
    const located = useCollections.getState().locate(nodeId)
    if (!located) return
    set({
      targetId: nodeId,
      targetName: located.node.type === 'request' ? located.node.request.name : located.node.name,
      items: itemsOf(located.node, true),
      results: [],
      dataError: null
    })
  },

  targets: () => {
    const out: RunTarget[] = []
    const walk = (node: CollectionNode, depth: number): void => {
      if (node.type === 'request') return
      out.push({ id: node.id, name: node.name, depth, requests: flattenRequests(node).length })
      for (const child of node.children) walk(child, depth + 1)
    }
    for (const c of useCollections.getState().doc.collections as CollectionNode[]) walk(c, 0)
    return out
  },

  toggleItem: (id) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, enabled: !i.enabled } : i)) })),
  setAllItems: (enabled) => set((s) => ({ items: s.items.map((i) => ({ ...i, enabled })) })),

  moveItem: (id, dir) =>
    set((s) => {
      const index = s.items.findIndex((i) => i.id === id)
      const next = index + dir
      if (index < 0 || next < 0 || next >= s.items.length) return {}
      const items = [...s.items]
      ;[items[index], items[next]] = [items[next], items[index]]
      return { items }
    }),

  close: () => {
    get().cancel()
    set({ open: false })
  },

  setIterations: (n) => set({ iterations: Math.max(1, Math.min(1000, Math.floor(n) || 1)) }),
  setDelay: (n) => set({ delayMs: Math.max(0, Math.min(60000, Math.floor(n) || 0)) }),
  setStopOnFailure: (v) => set({ stopOnFailure: v }),

  loadDataFile: async () => {
    const picked = await window.api.openFile({
      filters: [
        { name: tr('Файлы данных'), extensions: ['csv', 'json'] },
        { name: tr('Все файлы'), extensions: ['*'] }
      ]
    })
    if (!picked || !picked[0]) return
    const file = picked[0]
    try {
      const text = await window.api.readTextFile(file.filePath)
      let rows: Record<string, string>[]
      if (/\.json$/i.test(file.fileName)) {
        const parsed = JSON.parse(text)
        if (!Array.isArray(parsed)) throw new Error(tr('JSON-файл данных должен быть массивом объектов'))
        rows = parsed.map((row) => {
          const obj: Record<string, string> = {}
          for (const [k, v] of Object.entries(row ?? {})) obj[k] = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
          return obj
        })
      } else {
        rows = parseCsv(text)
      }
      set({ dataRows: rows, dataFileName: file.fileName, dataError: null, iterations: rows.length || 1 })
    } catch (err) {
      set({ dataError: err instanceof Error ? err.message : String(err), dataRows: [], dataFileName: null })
    }
  },

  clearData: () => set({ dataRows: [], dataFileName: null, dataError: null, iterations: 1 }),

  cancel: () => {
    aborted = true
    if (inFlightRequestId) void window.api.cancelRequest(inFlightRequestId)
  },

  run: async () => {
    if (get().running) return // never run two passes at once
    const collectionsState = useCollections.getState()
    // The list is the source of truth: a ticked entry runs, in list order.
    const requests = get()
      .items.filter((i) => i.enabled)
      .map((i) => ({ id: i.id, request: collectionsState.getRequest(i.id) }))
      .filter((r): r is { id: string; request: RequestModel } => !!r.request)
    if (requests.length === 0) {
      set({ dataError: tr('Не выбрано ни одного запроса') })
      return
    }

    aborted = false
    const dataRows = get().dataRows
    const iterations = Math.max(1, get().iterations)
    const delayMs = get().delayMs
    set({ running: true, results: [], current: null })

    const collections = useCollections.getState()
    const settings = settingsToRequestSettings()
    const totalSteps = iterations * requests.length
    let step = 0

    for (let iter = 0; iter < iterations && !aborted; iter++) {
      const row = dataRows.length ? dataRows[iter % dataRows.length] : {}
      const iterResult: IterationResult = { index: iter, requests: [] }

      for (const { id, request } of requests) {
        if (aborted) break
        step++
        set({ current: { iter: iter + 1, total: totalSteps, reqName: request.name } })

        const rr = await runOneRequest(request, id, row, collections, settings)
        iterResult.requests.push(rr)
        // "Stop on failure" covers both a transport error and a failed test.
        if (get().stopOnFailure && (rr.error || !rr.ok || rr.tests.some((t) => !t.passed))) aborted = true
        // Push a live snapshot so the panel updates as it goes.
        set((s) => {
          const results = [...s.results]
          results[iter] = { index: iter, requests: [...iterResult.requests] }
          return { results }
        })
        if (delayMs > 0 && !aborted) await delay(delayMs)
      }
      void step
    }

    inFlightRequestId = null
    set({ running: false, current: null })
  },

  exportReport: async () => {
    const s = get()
    const report = {
      target: s.targetName,
      startedAt: new Date().toISOString(),
      iterations: s.results.length,
      dataFile: s.dataFileName,
      results: s.results.map((it) => ({
        iteration: it.index + 1,
        requests: it.requests.map((r) => ({
          name: r.name,
          method: r.method,
          status: r.status,
          ok: r.ok,
          timeMs: r.timeMs,
          error: r.error,
          tests: r.tests
        }))
      }))
    }
    try {
      const saved = await window.api.saveFile({
        defaultName: 'relay-run-report.json',
        content: JSON.stringify(report, null, 2),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (saved) useUi.getState().showToast(tr('Отчёт сохранён'))
    } catch (err) {
      useUi.getState().showToast(err instanceof Error ? err.message : String(err), 'error')
    }
  }
}))

/** Run a single request through pre-request → send → tests with a data row bound. */
async function runOneRequest(
  request: RequestModel,
  savedRequestId: string,
  dataRow: Record<string, string>,
  collections: ReturnType<typeof useCollections.getState>,
  settings: ReturnType<typeof settingsToRequestSettings>
): Promise<RequestRunResult> {
  let workingReq: RequestModel = structuredClone(request)
  const base: RequestRunResult = {
    id: makeId('rr'),
    name: request.name,
    method: request.method,
    status: 0,
    ok: false,
    timeMs: 0,
    tests: []
  }

  const envStore = useEnvironments.getState()
  const collectionScope = collections.collectionScopeFor(savedRequestId)
  const ancestors = collections.ancestorScriptsFor(savedRequestId)

  // 1) pre-request scripts: collection/folder scripts top-down, then own. Data
  // row = highest-precedence iterationData.
  const prePhases = [
    ...ancestors.map((a) => a.preRequestScript).filter((s): s is string => !!s?.trim()),
    ...(workingReq.preRequestScript?.trim() ? [workingReq.preRequestScript] : [])
  ]
  for (const code of prePhases) {
    try {
      const pre = await window.api.runScript({
        phase: 'pre-request',
        code,
        request: workingReq,
        environment: envStore.envScope(),
        globals: envStore.globalScope(),
        collection: collectionScope,
        iterationData: dataRow,
        cookies: await cookieSnapshotFor(workingReq.url),
        url: workingReq.url
      })
      persistVarUpdates(pre.environmentUpdates, pre.globalUpdates)
      applyScriptSideEffects(savedRequestId, pre)
      if (pre.requestPatch) {
        workingReq = {
          ...workingReq,
          url: pre.requestPatch.url ?? workingReq.url,
          method: pre.requestPatch.method ?? workingReq.method,
          headers: pre.requestPatch.headers ?? workingReq.headers
        }
      }
    } catch {
      /* pre-request failure is non-fatal for the run */
    }
  }

  // 2) build spec — data row bound as the highest-precedence (local) scope
  const scope: VariableScope = {
    local: dataRow,
    collection: collectionScope,
    environment: envStore.envScope(),
    global: envStore.globalScope()
  }
  let spec
  try {
    spec = buildRequestSpec(workingReq, scope, settings, collections.inheritedAuthFor(savedRequestId)).spec
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }

  // 3) send
  const requestId = makeId('run')
  inFlightRequestId = requestId
  const result = await window.api.sendRequest(spec, { requestId })
  inFlightRequestId = null
  base.status = result.status
  base.ok = result.ok
  base.timeMs = result.timings.totalMs
  if (result.error) base.error = result.error.message

  // 4) test scripts — collection/folder top-down, then own. Skip entirely if the
  // run was cancelled while the send was in flight.
  const testPhases = [
    ...ancestors.map((a) => a.testScript).filter((s): s is string => !!s?.trim()),
    ...(workingReq.testScript?.trim() ? [workingReq.testScript] : [])
  ]
  if (testPhases.length && !aborted) {
    const cookies = await cookieSnapshotFor(workingReq.url)
    for (const code of testPhases) {
      try {
        const testRes = await window.api.runScript({
          phase: 'test',
          code,
          request: workingReq,
          response: result,
          environment: envStore.envScope(),
          globals: envStore.globalScope(),
          collection: collectionScope,
          iterationData: dataRow,
          cookies,
          url: workingReq.url
        })
        persistVarUpdates(testRes.environmentUpdates, testRes.globalUpdates)
        applyScriptSideEffects(savedRequestId, testRes)
        base.tests.push(...testRes.tests)
      } catch {
        /* test failure is captured per-test; ignore runner-level throw */
      }
    }
  }

  return base
}
