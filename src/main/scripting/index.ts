import { createContext, runInContext } from 'node:vm'
import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type {
  ScriptConsoleLine,
  ScriptRunRequest,
  ScriptRunResult,
  ScriptTestResult
} from '@shared/types'

/**
 * Sandboxed pre-request / test script runner with a `pm.*` subset.
 * Runs in an isolated vm context — no require, process, fs, or timers.
 */

class AssertionError extends Error {}

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
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
    private _deep = false
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
    return new Assertion(this.actual, !this.negate, this._deep)
  }
  get deep(): Assertion {
    return new Assertion(this.actual, this.negate, true)
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
  include(sub: unknown): void {
    let pass = false
    if (typeof this.actual === 'string') pass = this.actual.includes(String(sub))
    else if (Array.isArray(this.actual)) pass = this.actual.some((x) => deepEqual(x, sub))
    else if (this.actual && typeof this.actual === 'object' && sub && typeof sub === 'object')
      pass = Object.entries(sub as object).every(([k, v]) => deepEqual((this.actual as any)[k], v))
    this.check(pass, `expected ${json(this.actual)} to include ${json(sub)}`)
  }
  property(key: string, value?: unknown): Assertion {
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

export async function runScript(payload: ScriptRunRequest): Promise<ScriptRunResult> {
  const logs: ScriptConsoleLine[] = []
  const tests: ScriptTestResult[] = []
  const pendingTests: Promise<void>[] = []
  const envUpdates: Record<string, string | null> = {}
  const globalUpdates: Record<string, string | null> = {}

  // Null-prototype maps so a variable named like an Object.prototype member
  // ('toString', 'constructor', '__proto__', ...) resolves to undefined/false
  // instead of an inherited function, and `in` checks only see real variables.
  const env: Record<string, string> = Object.assign(Object.create(null), payload.environment)
  const globals: Record<string, string> = Object.assign(Object.create(null), payload.globals)
  const collection: Record<string, string> = Object.assign(Object.create(null), payload.collection ?? {})
  // Precedence mirrors the interpolation resolver: collection > environment > global.
  const merged = (): Record<string, string> => Object.assign(Object.create(null), globals, env, collection)

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
      has: (k: string) => k in merged()
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
    sendRequest: () => {
      throw new Error('pm.sendRequest is not supported in this sandbox')
    }
  }

  const sandboxConsole = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('log') }

  // Disallow eval / new Function inside the sandbox realm (defense in depth).
  // NOTE: node:vm is NOT a complete security boundary — host objects we expose
  // still reach the host Function via their prototype chain. Untrusted scripts
  // (e.g. imported collections) should ultimately run in an isolated worker.
  const context = createContext({ pm, console: sandboxConsole }, { codeGeneration: { strings: false, wasm: false } })

  try {
    runInContext(payload.code, context, { timeout: 3000, displayErrors: true })
  } catch (err) {
    return {
      logs,
      tests,
      environmentUpdates: envUpdates,
      globalUpdates,
      error: err instanceof Error ? err.message : String(err)
    }
  }

  // Settle any async pm.test(...) bodies, bounded so a non-resolving test can't hang.
  if (pendingTests.length) {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.allSettled(pendingTests),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 3000)
      })
    ])
    if (timer) clearTimeout(timer)
  }

  const requestPatch =
    payload.phase === 'pre-request'
      ? { url: reqState.url, method: reqState.method, headers: reqState.headers }
      : undefined

  return { logs, tests, environmentUpdates: envUpdates, globalUpdates, requestPatch }
}

export function registerScriptHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC.script.run, async (_e, payload: ScriptRunRequest) => runScript(payload))
}
