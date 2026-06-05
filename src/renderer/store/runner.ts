import { create } from 'zustand'
import type { CollectionNode, RequestModel, VariableScope } from '@shared/types'
import { makeId } from '@shared/id'
import { parseCsv } from '@shared/csv'
import { buildRequestSpec } from '../lib/request-spec'
import { settingsToRequestSettings, persistVarUpdates } from '../lib/request-runner'
import { useCollections } from './collections'
import { useEnvironments } from './environments'

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

interface RunnerState {
  open: boolean
  targetId: string | null
  targetName: string
  iterations: number
  delayMs: number
  dataRows: Record<string, string>[]
  dataFileName: string | null
  dataError: string | null
  running: boolean
  current: { iter: number; total: number; reqName: string } | null
  results: IterationResult[]
  openFor: (node: CollectionNode) => void
  close: () => void
  setIterations: (n: number) => void
  setDelay: (n: number) => void
  loadDataFile: () => Promise<void>
  clearData: () => void
  run: () => Promise<void>
  cancel: () => void
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

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const useRunner = create<RunnerState>((set, get) => ({
  open: false,
  targetId: null,
  targetName: '',
  iterations: 1,
  delayMs: 0,
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
      results: [],
      current: null,
      dataError: null
    }),

  close: () => {
    get().cancel()
    set({ open: false })
  },

  setIterations: (n) => set({ iterations: Math.max(1, Math.min(1000, Math.floor(n) || 1)) }),
  setDelay: (n) => set({ delayMs: Math.max(0, Math.min(60000, Math.floor(n) || 0)) }),

  loadDataFile: async () => {
    const picked = await window.api.openFile({
      filters: [
        { name: 'Data files', extensions: ['csv', 'json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (!picked || !picked[0]) return
    const file = picked[0]
    try {
      const text = await window.api.readTextFile(file.filePath)
      let rows: Record<string, string>[]
      if (/\.json$/i.test(file.fileName)) {
        const parsed = JSON.parse(text)
        if (!Array.isArray(parsed)) throw new Error('JSON-файл данных должен быть массивом объектов')
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
    const { targetId } = get()
    if (!targetId || get().running) return // never run two passes at once
    const located = useCollections.getState().locate(targetId)
    if (!located) return
    const requests = flattenRequests(located.node)
    if (requests.length === 0) {
      set({ dataError: 'В выбранном узле нет запросов' })
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

  // 1) pre-request script (data row = highest-precedence iterationData)
  if (workingReq.preRequestScript?.trim()) {
    try {
      const pre = await window.api.runScript({
        phase: 'pre-request',
        code: workingReq.preRequestScript,
        request: workingReq,
        environment: envStore.envScope(),
        globals: envStore.globalScope(),
        collection: collectionScope,
        iterationData: dataRow
      })
      persistVarUpdates(pre.environmentUpdates, pre.globalUpdates)
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

  // 4) test script — skip if the run was cancelled while the send was in flight.
  if (workingReq.testScript?.trim() && !aborted) {
    try {
      const testRes = await window.api.runScript({
        phase: 'test',
        code: workingReq.testScript,
        request: workingReq,
        response: result,
        environment: envStore.envScope(),
        globals: envStore.globalScope(),
        collection: collectionScope,
        iterationData: dataRow
      })
      persistVarUpdates(testRes.environmentUpdates, testRes.globalUpdates)
      base.tests = testRes.tests
    } catch {
      /* test failure is captured per-test; ignore runner-level throw */
    }
  }

  return base
}
