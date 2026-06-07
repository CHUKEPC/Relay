/**
 * The pure `pm.*` sandbox runner. NO electron / IPC / child-process concerns here
 * so it stays unit-testable. It is executed inside an isolated CHILD PROCESS (see
 * `startSandboxHost` + `runScript` in `./index.ts`) that is launched with
 * `--disallow-code-generation-from-strings`, which blocks `eval`/`Function`
 * (the only `node:vm` escape vector) — so even a hostile imported-collection
 * script cannot reach Node APIs, the main process, or its decrypted secrets.
 */
import { createContext, runInContext } from 'node:vm'
import type {
  ScriptConsoleLine,
  ScriptRunRequest,
  ScriptRunResult,
  ScriptTestResult,
  StoredCookie,
  VisualizerPayload
} from '@shared/types'

class AssertionError extends Error {}

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

/** Duck-typed RegExp check that survives the vm realm boundary (a `/x/` literal
 *  created inside the sandbox is not an instanceof the host RegExp). */
function isRegExpLike(v: unknown): v is { test: (s: string) => boolean } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { test?: unknown }).test === 'function' &&
    typeof (v as { source?: unknown }).source === 'string'
  )
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a && b && typeof a === 'object') {
    const ak = Object.keys(a as object)
    const bk = Object.keys(b as object)
    if (ak.length !== bk.length) return false
    return ak.every((k) => deepEqual((a as any)[k], (b as any)[k]))
  }
  return false
}

class Assertion {
  constructor(
    private actual: unknown,
    private negate = false,
    private _deep = false,
    private _nested = false
  ) {}

  private check(pass: boolean, message: string): void {
    const ok = this.negate ? !pass : pass
    if (!ok) throw new AssertionError(message)
  }

  // chain words (no-ops that return this)
  get to(): this {
    return this
  }
  get be(): this {
    return this
  }
  get been(): this {
    return this
  }
  get is(): this {
    return this
  }
  get that(): this {
    return this
  }
  get which(): this {
    return this
  }
  get and(): this {
    return this
  }
  get has(): this {
    return this
  }
  get have(): this {
    return this
  }
  get with(): this {
    return this
  }
  get of(): this {
    return this
  }
  get not(): Assertion {
    return new Assertion(this.actual, !this.negate, this._deep, this._nested)
  }
  get deep(): Assertion {
    return new Assertion(this.actual, this.negate, true, this._nested)
  }
  // `.nested.property('a.b.c')` resolves a dotted path instead of a flat key.
  get nested(): Assertion {
    return new Assertion(this.actual, this.negate, this._deep, true)
  }

  // terminal getters (return `this` so they can be used in a chain)
  get ok(): this {
    this.check(Boolean(this.actual), `expected ${json(this.actual)} to be ok`)
    return this
  }
  get true(): this {
    this.check(this.actual === true, `expected ${json(this.actual)} to be true`)
    return this
  }
  get false(): this {
    this.check(this.actual === false, `expected ${json(this.actual)} to be false`)
    return this
  }
  get null(): this {
    this.check(this.actual === null, `expected ${json(this.actual)} to be null`)
    return this
  }
  get undefined(): this {
    this.check(this.actual === undefined, `expected value to be undefined`)
    return this
  }
  get empty(): this {
    const len = (this.actual as any)?.length ?? Object.keys((this.actual as any) ?? {}).length
    this.check(len === 0, `expected ${json(this.actual)} to be empty`)
    return this
  }

  // methods
  equal(expected: unknown): void {
    const pass = this._deep ? deepEqual(this.actual, expected) : this.actual === expected
    this.check(pass, `expected ${json(this.actual)} to equal ${json(expected)}`)
  }
  eql(expected: unknown): void {
    this.check(deepEqual(this.actual, expected), `expected ${json(this.actual)} to deeply equal ${json(expected)}`)
  }
  a(type: string): Assertion {
    this.check(typeOf(this.actual) === type, `expected ${json(this.actual)} to be a ${type}`)
    return this
  }
  an(type: string): Assertion {
    return this.a(type)
  }
  above(n: number): void {
    this.check((this.actual as number) > n, `expected ${json(this.actual)} to be above ${n}`)
  }
  below(n: number): void {
    this.check((this.actual as number) < n, `expected ${json(this.actual)} to be below ${n}`)
  }
  least(n: number): void {
    this.check((this.actual as number) >= n, `expected ${json(this.actual)} to be at least ${n}`)
  }
  most(n: number): void {
    this.check((this.actual as number) <= n, `expected ${json(this.actual)} to be at most ${n}`)
  }
  private includeOf(sub: unknown): void {
    let pass = false
    if (typeof this.actual === 'string') pass = this.actual.includes(String(sub))
    else if (Array.isArray(this.actual)) pass = this.actual.some((x) => deepEqual(x, sub))
    else if (this.actual && typeof this.actual === 'object' && sub && typeof sub === 'object')
      pass = Object.entries(sub as object).every(([k, v]) => deepEqual((this.actual as any)[k], v))
    this.check(pass, `expected ${json(this.actual)} to include ${json(sub)}`)
  }
  /**
   * `include` is both a method (`expect(x).to.include(y)`) and a chainable
   * (`expect(arr).to.include.members([...])`). We expose it as a getter that
   * returns a callable carrying a `.members` method so both forms work.
   */
  get include(): ((sub: unknown) => void) & { members: (arr: unknown[]) => void } {
    const fn = ((sub: unknown) => this.includeOf(sub)) as ((sub: unknown) => void) & {
      members: (arr: unknown[]) => void
    }
    fn.members = (arr: unknown[]) => this.members(arr)
    return fn
  }
  get contain(): ((sub: unknown) => void) & { members: (arr: unknown[]) => void } {
    return this.include
  }
  get contains(): ((sub: unknown) => void) & { members: (arr: unknown[]) => void } {
    return this.include
  }
  property(key: string, value?: unknown): Assertion {
    if (this._nested) {
      // Walk a dotted path: 'a.b.c'. Existence requires every segment to resolve.
      const path = String(key).split('.')
      let cur: unknown = this.actual
      let exists = true
      for (const seg of path) {
        if (cur != null && Object.prototype.hasOwnProperty.call(cur, seg)) {
          cur = (cur as any)[seg]
        } else {
          exists = false
          cur = undefined
          break
        }
      }
      this.check(exists, `expected object to have nested property ${key}`)
      if (arguments.length > 1) this.check(deepEqual(cur, value), `nested property ${key} mismatch`)
      return new Assertion(cur, this.negate, this._deep)
    }
    const has = this.actual != null && Object.prototype.hasOwnProperty.call(this.actual, key)
    this.check(has, `expected object to have property ${key}`)
    if (arguments.length > 1) this.check(deepEqual((this.actual as any)[key], value), `property ${key} mismatch`)
    return new Assertion((this.actual as any)?.[key], this.negate, this._deep)
  }
  lengthOf(n: number): void {
    this.check((this.actual as any)?.length === n, `expected length ${n}`)
  }
  length(n: number): void {
    this.lengthOf(n)
  }
  match(re: RegExp): void {
    this.check(re.test(String(this.actual)), `expected ${json(this.actual)} to match ${re}`)
  }

  // --- additional chai-style methods (Postman parity) ----------------------

  /** Asserts the actual array contains every element of `arr` (order-insensitive,
   *  deep). Doubles as `.include.members` (chai aliases it). */
  members(arr: unknown[]): void {
    const actual = Array.isArray(this.actual) ? this.actual : []
    const pass = arr.every((want) => actual.some((have) => deepEqual(have, want)))
    this.check(pass, `expected ${json(this.actual)} to include members ${json(arr)}`)
  }

  /** Asserts the actual value deep-equals one of the supplied candidates. */
  oneOf(arr: unknown[]): void {
    const pass = arr.some((c) => deepEqual(this.actual, c))
    this.check(pass, `expected ${json(this.actual)} to be one of ${json(arr)}`)
  }

  /** Asserts the target object has exactly the given own keys (set equality). */
  keys(...names: Array<string | string[]>): void {
    const want = names.flat()
    const actualKeys =
      this.actual && typeof this.actual === 'object' ? Object.keys(this.actual as object) : []
    const pass = actualKeys.length === want.length && want.every((k) => actualKeys.includes(k))
    this.check(pass, `expected ${json(this.actual)} to have keys ${json(want)}`)
  }

  /** Asserts the actual number is within `delta` of `n`. */
  closeTo(n: number, delta: number): void {
    const pass = Math.abs((this.actual as number) - n) <= delta
    this.check(pass, `expected ${json(this.actual)} to be close to ${n} ±${delta}`)
  }

  /** Asserts the target function throws when invoked (optionally with a message
   *  substring or matching RegExp). `.Throw` is an alias chai also exposes. */
  throw(matcher?: string | RegExp): void {
    let threw = false
    let caught: unknown
    if (typeof this.actual === 'function') {
      const fn = this.actual as () => unknown
      try {
        fn()
      } catch (err) {
        threw = true
        caught = err
      }
    }
    let pass = threw
    if (threw && matcher != null) {
      const message = caught instanceof Error ? caught.message : String(caught)
      // Duck-type the RegExp: a literal created inside the vm realm is NOT an
      // instanceof the host RegExp, so check for a `.test` method instead.
      pass = isRegExpLike(matcher) ? matcher.test(message) : message.includes(String(matcher))
    }
    this.check(pass, `expected function to throw${matcher != null ? ` ${json(matcher)}` : ''}`)
  }
  Throw(matcher?: string | RegExp): void {
    this.throw(matcher)
  }

  /** Asserts the actual string contains `sub` (chai's `.string(...)`). */
  string(sub: string): void {
    this.check(String(this.actual).includes(sub), `expected ${json(this.actual)} to contain string ${json(sub)}`)
  }

  // numeric comparison aliases mirroring chai's named forms.
  greaterThan(n: number): void {
    this.above(n)
  }
  lessThan(n: number): void {
    this.below(n)
  }
  gte(n: number): void {
    this.least(n)
  }
  lte(n: number): void {
    this.most(n)
  }
}

function json(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/**
 * Coerce a script-supplied variable value to the string we persist. Objects are
 * JSON-serialized (not lossily turned into "[object Object]"); null/undefined
 * become an empty string instead of the literals "null"/"undefined".
 */
/** Round-trip a value through JSON so only plain, serializable data escapes the
 *  sandbox (drops functions/host objects; returns null on cycles/failure). */
function jsonSafe(v: unknown): unknown {
  if (v === undefined) return null
  try {
    return JSON.parse(JSON.stringify(v))
  } catch {
    return null
  }
}

function coerceVar(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

/** Hostname of a URL, or '' when it can't be parsed. */
function hostOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * RFC 6265-style domain match used by pm.cookies (read side). A cookie whose
 * (leading-dot-stripped) `domain` is the host itself or a suffix of it matches.
 * Kept dependency-free so the sandbox stays pure/unit-testable.
 */
function cookieDomainMatches(host: string, cookieDomain: string): boolean {
  if (!host || !cookieDomain) return false
  const d = cookieDomain.replace(/^\./, '').toLowerCase()
  if (host === d) return true
  return host.endsWith(`.${d}`)
}

/** A request accepted by pm.sendRequest (string URL or a Postman-like object). */
type SendRequestInput =
  | string
  | {
      url?: string
      method?: string
      header?: Array<{ key: string; value: string }> | Record<string, string>
      body?: { mode?: string; raw?: string } | string
    }

/** The Postman-like response object handed back from pm.sendRequest. */
interface SendRequestResponse {
  code: number
  status: string
  responseTime: number
  headers: { get: (name: string) => string | undefined }
  text: () => string
  json: () => unknown
}

/**
 * Perform a real HTTP request from inside the sandbox using the global `fetch`
 * (Node 20+). This deliberately does NOT use the app's cookie jar, proxy, or
 * client-cert config — it is a bare fetch, so cookies/proxy are NOT applied.
 */
async function performSendRequest(input: SendRequestInput): Promise<SendRequestResponse> {
  let url: string
  let method = 'GET'
  const headers: Record<string, string> = {}
  let body: string | undefined

  if (typeof input === 'string') {
    url = input
  } else {
    url = String(input.url ?? '')
    if (input.method) method = String(input.method).toUpperCase()
    if (Array.isArray(input.header)) {
      for (const h of input.header) if (h && h.key) headers[h.key] = String(h.value ?? '')
    } else if (input.header && typeof input.header === 'object') {
      for (const [k, v] of Object.entries(input.header)) headers[k] = String(v ?? '')
    }
    if (typeof input.body === 'string') body = input.body
    else if (input.body && input.body.mode === 'raw' && typeof input.body.raw === 'string') body = input.body.raw
  }

  if (!url) throw new Error('pm.sendRequest: a URL is required')

  const startedAt = Date.now()
  // `fetch` rejects HEAD/GET with a body, so only attach one for other methods.
  const init: RequestInit = { method, headers }
  if (body != null && method !== 'GET' && method !== 'HEAD') init.body = body
  const res = await fetch(url, init)
  const responseTime = Date.now() - startedAt
  const textBody = await res.text()

  return {
    code: res.status,
    status: res.statusText,
    responseTime,
    headers: { get: (name: string) => res.headers.get(name) ?? undefined },
    text: () => textBody,
    json: () => JSON.parse(textBody)
  }
}

/**
 * Build the `pm.cookies` surface. Reads from the request-domain cookie snapshot
 * in `payload.cookies`; jar().set/unset record mutations into `cookieUpdates`
 * (applied to the persistent jar by the renderer after the run).
 */
function buildCookies(
  payload: ScriptRunRequest,
  cookieUpdates: NonNullable<ScriptRunResult['cookieUpdates']>
): {
  get: (name: string) => string | undefined
  has: (name: string) => boolean
  toObject: () => Record<string, string>
  jar: () => {
    set: (cookie: Partial<StoredCookie> & { name?: string; key?: string; value?: string }) => void
    unset: (target: { name?: string; key?: string; domain?: string; path?: string }) => void
    get: (name: string) => string | undefined
  }
} {
  const snapshot = (payload.cookies ?? []).filter((c) => c && c.key)
  const host = hostOf(payload.url)
  // Only cookies whose domain matches the request host are visible (Postman).
  const matching = host ? snapshot.filter((c) => cookieDomainMatches(host, c.domain)) : snapshot.slice()

  const get = (name: string): string | undefined => matching.find((c) => c.key === name)?.value
  const has = (name: string): boolean => matching.some((c) => c.key === name)
  const toObject = (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const c of matching) out[c.key] = c.value
    return out
  }

  const jar = () => ({
    get,
    set: (cookie: Partial<StoredCookie> & { name?: string; key?: string; value?: string }) => {
      const key = cookie.key ?? cookie.name
      if (!key) return
      const next: StoredCookie = {
        key,
        value: cookie.value ?? '',
        domain: (cookie.domain ?? host ?? '').replace(/^\./, '').toLowerCase(),
        path: cookie.path ?? '/',
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure
      }
      if (!next.domain) return
      const set = (cookieUpdates.set ??= [])
      set.push(next)
    },
    unset: (target: { name?: string; key?: string; domain?: string; path?: string }) => {
      const key = target.key ?? target.name
      if (!key) return
      const remove = (cookieUpdates.remove ??= [])
      remove.push({
        key,
        domain: (target.domain ?? host ?? '').replace(/^\./, '').toLowerCase(),
        path: target.path ?? '/'
      })
    }
  })

  return { get, has, toObject, jar }
}

export async function runSandbox(payload: ScriptRunRequest): Promise<ScriptRunResult> {
  const logs: ScriptConsoleLine[] = []
  const tests: ScriptTestResult[] = []
  const pendingTests: Promise<void>[] = []
  const pendingRequests: Promise<unknown>[] = []
  const envUpdates: Record<string, string | null> = {}
  const globalUpdates: Record<string, string | null> = {}
  const collectionUpdates: Record<string, string | null> = {}
  const cookieUpdates: NonNullable<ScriptRunResult['cookieUpdates']> = {}

  // Null-prototype maps so a variable named like an Object.prototype member
  // ('toString', 'constructor', '__proto__', ...) resolves to undefined/false
  // instead of an inherited function, and `in` checks only see real variables.
  const env: Record<string, string> = Object.assign(Object.create(null), payload.environment)
  const globals: Record<string, string> = Object.assign(Object.create(null), payload.globals)
  const collection: Record<string, string> = Object.assign(Object.create(null), payload.collection ?? {})
  const iterationData: Record<string, string> = Object.assign(Object.create(null), payload.iterationData ?? {})
  // Ephemeral, highest-precedence scope written by pm.variables.set during the
  // run (Postman 'local' vars). NOT persisted; affects merged() only this run.
  const local: Record<string, string> = Object.create(null)
  // Precedence mirrors the interpolation resolver: local > data > collection > environment > global.
  const merged = (): Record<string, string> =>
    Object.assign(Object.create(null), globals, env, collection, iterationData, local)

  // Captured by pm.visualizer.set(template, data) — returned for the Visualize tab.
  let visualizer: VisualizerPayload | null = null

  const reqState = {
    url: payload.request.url,
    method: payload.request.method,
    headers: payload.request.headers.map((h) => ({ ...h }))
  }

  const log =
    (level: ScriptConsoleLine['level']) =>
    (...args: unknown[]) =>
      logs.push({ level, message: args.map((a) => (typeof a === 'string' ? a : json(a))).join(' ') })

  const responseObj = payload.response
    ? {
        code: payload.response.status,
        status: payload.response.statusText,
        responseTime: payload.response.timings.totalMs,
        responseSize: payload.response.body.sizeBytes,
        text: () => payload.response?.body.text ?? '',
        json: () => JSON.parse(payload.response?.body.text ?? 'null'),
        headers: {
          get: (name: string) =>
            payload.response?.headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1],
          all: () => payload.response?.headers ?? []
        },
        to: {
          have: {
            status: (code: number | string) => {
              const pass =
                typeof code === 'number'
                  ? payload.response?.status === code
                  : payload.response?.statusText === code
              if (!pass) throw new AssertionError(`expected status ${code}, got ${payload.response?.status}`)
            },
            header: (name: string) => {
              const pass = payload.response?.headers.some(([k]) => k.toLowerCase() === name.toLowerCase())
              if (!pass) throw new AssertionError(`expected header ${name}`)
            }
          },
          be: {
            json: () => {
              try {
                JSON.parse(payload.response?.body.text ?? '')
              } catch {
                throw new AssertionError('expected body to be JSON')
              }
            }
          }
        }
      }
    : undefined

  const pm = {
    environment: {
      get: (k: string) => env[k],
      set: (k: string, v: unknown) => {
        const s = coerceVar(v)
        env[k] = s
        envUpdates[k] = s
      },
      unset: (k: string) => {
        delete env[k]
        envUpdates[k] = null
      },
      toObject: () => ({ ...env })
    },
    globals: {
      get: (k: string) => globals[k],
      set: (k: string, v: unknown) => {
        const s = coerceVar(v)
        globals[k] = s
        globalUpdates[k] = s
      },
      unset: (k: string) => {
        delete globals[k]
        globalUpdates[k] = null
      },
      toObject: () => ({ ...globals })
    },
    variables: {
      get: (k: string) => merged()[k],
      has: (k: string) => k in merged(),
      // pm.variables.set writes to the ephemeral LOCAL scope: it wins over every
      // other scope inside this run and is NOT persisted (Postman 'local' vars).
      set: (k: string, v: unknown) => {
        local[k] = coerceVar(v)
      },
      unset: (k: string) => {
        delete local[k]
      }
    },
    collectionVariables: {
      get: (k: string) => collection[k],
      has: (k: string) => k in collection,
      set: (k: string, v: unknown) => {
        const s = coerceVar(v)
        collection[k] = s
        collectionUpdates[k] = s
      },
      unset: (k: string) => {
        delete collection[k]
        collectionUpdates[k] = null
      },
      toObject: () => ({ ...collection })
    },
    cookies: buildCookies(payload, cookieUpdates),
    iterationData: {
      get: (k: string) => iterationData[k],
      has: (k: string) => k in iterationData,
      toObject: () => ({ ...iterationData })
    },
    visualizer: {
      // Capture a Postman-style visualizer template + data. `data` is sanitized
      // to a JSON-safe value so it survives the child→parent IPC boundary and
      // can't smuggle functions/host objects out of the sandbox.
      set: (template: unknown, data?: unknown) => {
        visualizer = { template: typeof template === 'string' ? template : String(template ?? ''), data: jsonSafe(data) }
      }
    },
    request: {
      get url() {
        return reqState.url
      },
      set url(v: string) {
        reqState.url = v
      },
      get method() {
        return reqState.method
      },
      set method(v: string) {
        reqState.method = v
      },
      headers: {
        add: (h: { key: string; value: string }) => reqState.headers.push({ ...h, enabled: true }),
        upsert: (h: { key: string; value: string }) => {
          const found = reqState.headers.find((x) => x.key.toLowerCase() === h.key.toLowerCase())
          if (found) found.value = h.value
          else reqState.headers.push({ ...h, enabled: true })
        },
        get: (name: string) => reqState.headers.find((x) => x.key.toLowerCase() === name.toLowerCase())?.value
      }
    },
    response: responseObj,
    test: (name: string, fn: () => void | Promise<void>) => {
      try {
        const r = fn() as unknown
        if (r && typeof (r as PromiseLike<unknown>).then === 'function') {
          // Async test body: record the verdict when it settles (awaited below),
          // instead of falsely passing and leaking an unhandled rejection.
          pendingTests.push(
            Promise.resolve(r).then(
              () => {
                tests.push({ name, passed: true })
              },
              (err) => {
                tests.push({ name, passed: false, error: err instanceof Error ? err.message : String(err) })
              }
            )
          )
        } else {
          tests.push({ name, passed: true })
        }
      } catch (err) {
        tests.push({ name, passed: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
    expect: (actual: unknown) => new Assertion(actual),
    // pm.sendRequest(urlOrReq, callback?) — performs a real HTTP request via the
    // child's global fetch. Calls back (err, res) Postman-style and also returns a
    // promise. NOTE: no cookie jar / proxy / client certs are applied (bare fetch).
    sendRequest: (
      input: SendRequestInput,
      cb?: (err: Error | null, res?: SendRequestResponse) => void
    ): Promise<SendRequestResponse> => {
      const p = performSendRequest(input)
      // Track the callback chain (not just the raw request) so the async-settle
      // window also waits for work the callback does (e.g. setting a variable).
      const settled =
        typeof cb === 'function'
          ? p.then(
              (res) => cb(null, res),
              (err) => cb(err instanceof Error ? err : new Error(String(err)))
            )
          : p
      pendingRequests.push(settled.catch(() => undefined))
      return p
    }
  }

  const sandboxConsole = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('log') }

  // Disallow eval / new Function inside the sandbox realm (defense in depth on
  // top of the process-level --disallow-code-generation-from-strings flag).
  const context = createContext({ pm, console: sandboxConsole }, { codeGeneration: { strings: false, wasm: false } })

  // Surface collection-variable / cookie mutations (only when non-empty so the
  // result stays compact and the renderer can skip a no-op write).
  const finalize = (error?: string): ScriptRunResult => {
    const requestPatch =
      payload.phase === 'pre-request'
        ? { url: reqState.url, method: reqState.method, headers: reqState.headers }
        : undefined
    const result: ScriptRunResult = {
      logs,
      tests,
      environmentUpdates: envUpdates,
      globalUpdates,
      requestPatch,
      visualizer
    }
    if (Object.keys(collectionUpdates).length) result.collectionUpdates = collectionUpdates
    if (cookieUpdates.set?.length || cookieUpdates.remove?.length) result.cookieUpdates = cookieUpdates
    if (error != null) result.error = error
    return result
  }

  try {
    runInContext(payload.code, context, { timeout: 3000, displayErrors: true })
  } catch (err) {
    return finalize(err instanceof Error ? err.message : String(err))
  }

  // Settle any async pm.test(...) bodies and in-flight pm.sendRequest() calls,
  // bounded so a non-resolving promise can't hang the run.
  const pending = [...pendingTests, ...pendingRequests]
  if (pending.length) {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 3000)
      })
    ])
    if (timer) clearTimeout(timer)
  }

  return finalize()
}
