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
  HttpMethod,
  KV,
  RawLanguage,
  RequestBody,
  RequestSettings,
  RequestSpec,
  ScriptConsoleLine,
  ScriptRunRequest,
  ScriptRunResult,
  ScriptTestResult,
  StoredCookie,
  VisualizerPayload
} from '@shared/types'
import { runRequest } from '../http/engine'

class AssertionError extends Error {}

/**
 * The run currently executing in this child, so an async failure that surfaces
 * outside the script's own call stack still lands in its result.
 *
 * Node kills the process on an unhandled rejection, and a script that fires a
 * pm.sendRequest without handling its promise used to take the whole sandbox
 * down with it — «Script sandbox stopped», with the work of every other request
 * in the script lost. The host installs process-level handlers that route here
 * instead (see startSandboxHost).
 */
let activeRun: { logs: ScriptConsoleLine[]; errors: string[] } | null = null

/**
 * Did the last run end with async work still in flight? The host keeps finished
 * children warm for the next script (see `keepWarm` in ./index.ts), and a
 * pm.sendRequest that never came back could still deliver its callback — or an
 * unhandled rejection — into the NEXT script's result. Such a child is retired
 * instead of reused.
 */
let pendingWork = false

export function sandboxLeftPendingWork(): boolean {
  return pendingWork
}

/**
 * Record an async failure against the running script. Returns false when no run
 * is in flight (a late rejection from an already-finished script), so the caller
 * can decide what to do with it.
 */
export function recordAsyncScriptError(message: string, fatal = true): boolean {
  if (!activeRun) return false
  // One failure reaches here twice: once from the promise we track, once from
  // the process handler for the chain the script built on top of it.
  if (!activeRun.logs.some((l) => l.level === 'error' && l.message === message)) {
    activeRun.logs.push({ level: 'error', message })
  }
  if (fatal && !activeRun.errors.includes(message)) activeRun.errors.push(message)
  return true
}

/**
 * chai-style type name. Works across the vm realm boundary: a value parsed by
 * pm.response.json() is built in the host realm, an array literal in the script
 * realm, so `instanceof` cannot tell them apart and the toString tag can.
 */
function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  const t = typeof v
  if (t !== 'object') return t
  return Object.prototype.toString.call(v).slice(8, -1).toLowerCase()
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
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b)
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const kind = typeOf(a)
  if (kind !== typeOf(b)) return false
  if (kind === 'date') return (a as Date).getTime() === (b as Date).getTime()
  if (kind === 'regexp') return String(a) === String(b)
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as any)[k], (b as any)[k]))
}

/** `a.b[0].c` → ['a', 'b', '0', 'c'] — the path syntax of chai and Postman. */
function parsePath(path: string): string[] {
  return path
    .replace(/\[(\w+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
}

function walkPath(root: unknown, path: string): { exists: boolean; value: unknown } {
  let cur: unknown = root
  for (const seg of parsePath(path)) {
    if (cur == null || !Object.prototype.hasOwnProperty.call(cur, seg)) return { exists: false, value: undefined }
    cur = (cur as any)[seg]
  }
  return { exists: true, value: cur }
}

function lengthOf(v: unknown): number | undefined {
  const kind = typeOf(v)
  if (kind === 'map' || kind === 'set') return (v as { size: number }).size
  const len = (v as { length?: unknown } | null | undefined)?.length
  return typeof len === 'number' ? len : undefined
}

/**
 * The responses the response assertions understand: pm.response and the
 * results of pm.sendRequest. Registered by identity, so an object that merely
 * looks like a response is not treated as one.
 */
interface ResponseView {
  code: number
  status: string
  headers: { get: (name: string) => string | undefined }
  text: () => string
  json: () => unknown
}
const responseViews = new WeakSet<object>()

function asResponse(v: unknown): ResponseView | null {
  return typeof v === 'object' && v !== null && responseViews.has(v) ? (v as ResponseView) : null
}

/** Make `view.to.have.status(…)`, `view.to.be.ok`… available on a response. */
function assertable<T extends object>(view: T): T {
  responseViews.add(view)
  Object.defineProperty(view, 'to', { get: () => expectValue(view), enumerable: false })
  return view
}

/** A short, readable rendering of a value for an assertion message. */
function show(v: unknown): string {
  if (v === undefined) return 'undefined'
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'symbol') return String(v)
  if (typeof v === 'function') return '[Function]'
  const r = asResponse(v)
  if (r) return `response ${r.code}`
  const s = json(v) ?? String(v)
  return s.length > 120 ? `${s.slice(0, 117)}...` : s
}

/* ============================================================
 * pm.expect — a chai-compatible assertion chain
 * ============================================================ */

/** Modifiers set by chain words; they change what the next assertion checks. */
interface Flags {
  negate?: boolean
  deep?: boolean
  nested?: boolean
  own?: boolean
  /** `.any.keys` */
  any?: boolean
  /** `.include` / `.contain` used as a chain: `.include.members`, `.include.keys` */
  contains?: boolean
  /** `.ordered.members` */
  ordered?: boolean
  /** `.lengthOf` / `.length` used as a chain: compare the length, not the value */
  length?: boolean
}

const STATE = Symbol('assertion')

/**
 * Property names the runtime itself may look up on an assertion — awaiting a
 * returned value, printing or serialising it. They are never a typo in a test.
 */
const PASS_THROUGH = new Set(['then', 'catch', 'inspect', 'toJSON', 'message', 'stack', 'name', 'nodeType', 'asymmetricMatch', '$$typeof'])

/**
 * Wrap an assertion so that reading a word it does not know THROWS.
 *
 * Without this, a misspelt or unsupported property (`.to.be.tru`, `.to.exist`
 * on a runtime that lacks it, Postman's `pm.response.to.be.json` without
 * parentheses) reads as `undefined`, nothing throws, and pm.test records a pass
 * whatever the response was. chai guards its chains the same way.
 */
function guard(target: Assertion): Assertion {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === 'string' && !PASS_THROUGH.has(prop) && !Reflect.has(t, prop)) {
        throw new Error(`Invalid or unsupported assertion property: ${prop}`)
      }
      return Reflect.get(t, prop, receiver)
    }
  })
}

function expectValue(actual: unknown, flags: Flags = {}): Assertion {
  return guard(new Assertion(actual, flags))
}

type Chainable = Assertion & ((...args: any[]) => Assertion)

/**
 * A word that is both a method and a chain — `.include(x)` and
 * `.include.members([…])`, `.lengthOf(3)` and `.lengthOf.above(2)`,
 * `.an('array')` and `.an.instanceOf(Array)`. Calling it runs `call`; reading a
 * property continues the chain on `next`.
 */
function chainable(next: Assertion, call: (...args: any[]) => Assertion): Chainable {
  return new Proxy(() => undefined, {
    apply: (_t, _self, args) => call(...args),
    get: (_t, prop) => Reflect.get(next, prop),
    has: (_t, prop) => Reflect.has(next, prop)
  }) as unknown as Chainable
}

function derive(a: Assertion, extra: Flags): Assertion {
  const { actual, flags } = a[STATE]
  return expectValue(actual, { ...flags, ...extra })
}

/** Pass/fail honouring `.not`. `what` reads as in "expected 5 to be above 3". */
function verify(a: Assertion, pass: boolean, what: string, detail?: string): void {
  const { actual, flags } = a[STATE]
  if (flags.negate ? !pass : pass) return
  const tail = detail ? ` (${detail})` : ''
  throw new AssertionError(`expected ${show(actual)} ${flags.negate ? 'not ' : ''}to ${what}${tail}`)
}

/** A misuse that fails whether or not `.not` is set (chai throws on these too). */
function misuse(message: string): never {
  throw new AssertionError(message)
}

/** The number a comparison works on (the value, or its length after
 *  `.lengthOf`) and its bounds; dates compare by time. Fails on anything else. */
function numbers(a: Assertion, word: string, bounds: unknown[]): { value: number; limits: number[] } {
  const { actual, flags } = a[STATE]
  const num = (x: unknown): number | undefined =>
    typeof x === 'number' ? x : typeOf(x) === 'date' ? (x as Date).getTime() : undefined
  const value = num(flags.length ? lengthOf(actual) : actual)
  if (value === undefined) misuse(`expected ${show(actual)} to ${flags.length ? 'have a length' : 'be a number or a date'}`)
  const limits = bounds.map((b) => num(b) ?? misuse(`the bound for "${word}" must be a number or a date, got ${show(b)}`))
  return { value, limits }
}

function compare(a: Assertion, word: string, n: unknown, pass: (v: number, n: number) => boolean): Assertion {
  const { value, limits } = numbers(a, word, [n])
  verify(a, pass(value, limits[0]), `${a[STATE].flags.length ? 'have a length' : 'be'} ${word} ${show(n)}`)
  return a
}

function needResponse(a: Assertion, word: string): ResponseView {
  const { actual } = a[STATE]
  return asResponse(actual) ?? misuse(`.${word} applies to pm.response or a pm.sendRequest response, not ${show(actual)}`)
}

function statusIs(a: Assertion, what: string, pass: (code: number) => boolean): Assertion {
  const r = needResponse(a, what)
  verify(a, pass(r.code), `be ${what}`, `status ${r.code}`)
  return a
}

/** Built-in constructors recognised by kind, so `instanceOf(Array)` holds for a
 *  JSON array that was parsed outside the script's realm. */
const BUILTIN_KINDS: Record<string, string> = {
  Array: 'array',
  Date: 'date',
  RegExp: 'regexp',
  Error: 'error',
  Map: 'map',
  Set: 'set',
  Promise: 'promise'
}

class Assertion {
  readonly [STATE]: { actual: unknown; flags: Flags }

  constructor(actual: unknown, flags: Flags) {
    this[STATE] = { actual, flags }
  }

  // --- language chains: readability only ------------------------------------
  get to(): Assertion {
    return this
  }
  get be(): Assertion {
    return this
  }
  get been(): Assertion {
    return this
  }
  get is(): Assertion {
    return this
  }
  get that(): Assertion {
    return this
  }
  get which(): Assertion {
    return this
  }
  get and(): Assertion {
    return this
  }
  get has(): Assertion {
    return this
  }
  get have(): Assertion {
    return this
  }
  get with(): Assertion {
    return this
  }
  get at(): Assertion {
    return this
  }
  get of(): Assertion {
    return this
  }
  get same(): Assertion {
    return this
  }
  get but(): Assertion {
    return this
  }
  get does(): Assertion {
    return this
  }
  get still(): Assertion {
    return this
  }
  get also(): Assertion {
    return this
  }

  // --- flags ---------------------------------------------------------------
  get not(): Assertion {
    return derive(this, { negate: !this[STATE].flags.negate })
  }
  get deep(): Assertion {
    return derive(this, { deep: true })
  }
  /** `.nested.property('a.b[0].c')` resolves a path instead of a flat key. */
  get nested(): Assertion {
    return derive(this, { nested: true })
  }
  get own(): Assertion {
    return derive(this, { own: true })
  }
  get any(): Assertion {
    return derive(this, { any: true })
  }
  get all(): Assertion {
    return derive(this, { any: false })
  }
  get ordered(): Assertion {
    return derive(this, { ordered: true })
  }

  // --- property assertions --------------------------------------------------
  /** Truthy — or, on a response, status 200 (Postman's `pm.response.to.be.ok`). */
  get ok(): Assertion {
    const r = asResponse(this[STATE].actual)
    if (r) return statusIs(this, 'ok', (c) => c === 200)
    verify(this, Boolean(this[STATE].actual), 'be ok')
    return this
  }
  get true(): Assertion {
    verify(this, this[STATE].actual === true, 'be true')
    return this
  }
  get false(): Assertion {
    verify(this, this[STATE].actual === false, 'be false')
    return this
  }
  get null(): Assertion {
    verify(this, this[STATE].actual === null, 'be null')
    return this
  }
  get undefined(): Assertion {
    verify(this, this[STATE].actual === undefined, 'be undefined')
    return this
  }
  get NaN(): Assertion {
    verify(this, Number.isNaN(this[STATE].actual), 'be NaN')
    return this
  }
  get exist(): Assertion {
    verify(this, this[STATE].actual != null, 'exist')
    return this
  }
  get finite(): Assertion {
    verify(this, Number.isFinite(this[STATE].actual), 'be a finite number')
    return this
  }
  get empty(): Assertion {
    const { actual } = this[STATE]
    const kind = typeOf(actual)
    let size: number | undefined
    if (kind === 'string' || kind === 'array' || kind === 'map' || kind === 'set') size = lengthOf(actual)
    else if (kind === 'object') size = Object.keys(actual as object).length
    if (size === undefined) misuse(`.empty needs a string, array, object, Map or Set, got ${show(actual)}`)
    verify(this, size === 0, 'be empty')
    return this
  }
  get extensible(): Assertion {
    const { actual } = this[STATE]
    verify(this, Object(actual) === actual && Object.isExtensible(actual), 'be extensible')
    return this
  }
  get sealed(): Assertion {
    verify(this, Object.isSealed(this[STATE].actual), 'be sealed')
    return this
  }
  get frozen(): Assertion {
    verify(this, Object.isFrozen(this[STATE].actual), 'be frozen')
    return this
  }

  // --- type and equality ----------------------------------------------------
  get a(): Chainable {
    return chainable(this, (type: string) => {
      verify(this, typeOf(this[STATE].actual) === String(type).toLowerCase(), `be a ${type}`)
      return this
    })
  }
  get an(): Chainable {
    return this.a
  }
  equal(expected: unknown): Assertion {
    const { actual, flags } = this[STATE]
    if (flags.length) {
      verify(this, lengthOf(actual) === expected, `have length ${show(expected)}`)
      return this
    }
    const pass = flags.deep ? deepEqual(actual, expected) : actual === expected
    verify(this, pass, `${flags.deep ? 'deeply ' : ''}equal ${show(expected)}`)
    return this
  }
  equals(expected: unknown): Assertion {
    return this.equal(expected)
  }
  eq(expected: unknown): Assertion {
    return this.equal(expected)
  }
  eql(expected: unknown): Assertion {
    verify(this, deepEqual(this[STATE].actual, expected), `deeply equal ${show(expected)}`)
    return this
  }
  eqls(expected: unknown): Assertion {
    return this.eql(expected)
  }
  instanceOf(ctor: unknown): Assertion {
    if (typeof ctor !== 'function') misuse(`instanceOf needs a constructor, got ${show(ctor)}`)
    const { actual } = this[STATE]
    const isObject = (typeof actual === 'object' && actual !== null) || typeof actual === 'function'
    let pass = isObject && actual instanceof (ctor as new (...args: never[]) => unknown)
    const name = (ctor as { name?: string }).name ?? ''
    const native = Function.prototype.toString.call(ctor).includes('[native code]')
    if (!pass && native && name === 'Object') pass = isObject
    if (!pass && native && BUILTIN_KINDS[name]) pass = typeOf(actual) === BUILTIN_KINDS[name]
    verify(this, pass, `be an instance of ${name || 'the given constructor'}`)
    return this
  }
  instanceof(ctor: unknown): Assertion {
    return this.instanceOf(ctor)
  }
  oneOf(list: unknown[]): Assertion {
    const items = Array.isArray(list) ? list : misuse(`oneOf needs an array, got ${show(list)}`)
    verify(this, items.some((c) => deepEqual(this[STATE].actual, c)), `be one of ${show(items)}`)
    return this
  }
  satisfy(fn: unknown): Assertion {
    if (typeof fn !== 'function') misuse(`satisfy needs a function, got ${show(fn)}`)
    verify(this, Boolean((fn as (v: unknown) => unknown)(this[STATE].actual)), 'satisfy the given condition')
    return this
  }
  satisfies(fn: unknown): Assertion {
    return this.satisfy(fn)
  }

  // --- numbers --------------------------------------------------------------
  above(n: unknown): Assertion {
    return compare(this, 'above', n, (v, b) => v > b)
  }
  gt(n: unknown): Assertion {
    return this.above(n)
  }
  greaterThan(n: unknown): Assertion {
    return this.above(n)
  }
  below(n: unknown): Assertion {
    return compare(this, 'below', n, (v, b) => v < b)
  }
  lt(n: unknown): Assertion {
    return this.below(n)
  }
  lessThan(n: unknown): Assertion {
    return this.below(n)
  }
  least(n: unknown): Assertion {
    return compare(this, 'at least', n, (v, b) => v >= b)
  }
  gte(n: unknown): Assertion {
    return this.least(n)
  }
  greaterThanOrEqual(n: unknown): Assertion {
    return this.least(n)
  }
  most(n: unknown): Assertion {
    return compare(this, 'at most', n, (v, b) => v <= b)
  }
  lte(n: unknown): Assertion {
    return this.most(n)
  }
  lessThanOrEqual(n: unknown): Assertion {
    return this.most(n)
  }
  within(lo: unknown, hi: unknown): Assertion {
    const { value, limits } = numbers(this, 'within', [lo, hi])
    const label = this[STATE].flags.length ? 'have a length' : 'be'
    verify(this, value >= limits[0] && value <= limits[1], `${label} within ${show(lo)}..${show(hi)}`)
    return this
  }
  closeTo(n: number, delta: number): Assertion {
    const { actual } = this[STATE]
    if (typeof actual !== 'number') misuse(`expected ${show(actual)} to be a number`)
    verify(this, Math.abs(actual - n) <= delta, `be close to ${n} ±${delta}`)
    return this
  }
  approximately(n: number, delta: number): Assertion {
    return this.closeTo(n, delta)
  }

  // --- strings, collections, objects ----------------------------------------
  /** `.include(x)` checks membership; `.include.members(…)` / `.include.keys(…)`
   *  switch those to subset semantics. */
  get include(): Chainable {
    return chainable(derive(this, { contains: true }), (sub: unknown) => {
      const { actual } = this[STATE]
      const kind = typeOf(actual)
      let pass: boolean
      if (kind === 'string') pass = (actual as string).includes(String(sub))
      else if (kind === 'array') pass = (actual as unknown[]).some((x) => deepEqual(x, sub))
      else if (kind === 'set') pass = [...(actual as Set<unknown>)].some((x) => deepEqual(x, sub))
      else if (kind === 'map') pass = [...(actual as Map<unknown, unknown>).values()].some((x) => deepEqual(x, sub))
      else if (kind === 'object' && sub !== null && typeof sub === 'object')
        pass = Object.entries(sub).every(([k, v]) => deepEqual((actual as any)[k], v))
      else misuse(`.include needs a string, array, Set, Map or object, got ${show(actual)}`)
      verify(this, pass, `include ${show(sub)}`)
      return this
    })
  }
  get includes(): Chainable {
    return this.include
  }
  get contain(): Chainable {
    return this.include
  }
  get contains(): Chainable {
    return this.include
  }
  /** `.lengthOf(3)` checks the length; `.lengthOf.above(2)` compares it. */
  get lengthOf(): Chainable {
    return chainable(derive(this, { length: true }), (n: unknown) => {
      const len = lengthOf(this[STATE].actual)
      verify(this, len === n, `have length ${show(n)}`, `length ${len}`)
      return this
    })
  }
  get length(): Chainable {
    return this.lengthOf
  }
  match(re: unknown): Assertion {
    if (!isRegExpLike(re)) misuse(`match needs a regular expression, got ${show(re)}`)
    verify(this, re.test(String(this[STATE].actual)), `match ${String(re)}`)
    return this
  }
  matches(re: unknown): Assertion {
    return this.match(re)
  }
  string(sub: string): Assertion {
    verify(this, String(this[STATE].actual).includes(sub), `contain string ${show(sub)}`)
    return this
  }
  property(name: string, ...value: unknown[]): Assertion {
    const { actual, flags } = this[STATE]
    let exists: boolean
    let found: unknown
    if (flags.nested) {
      const hit = walkPath(actual, String(name))
      exists = hit.exists
      found = hit.value
    } else if (flags.own) {
      exists = actual != null && Object.prototype.hasOwnProperty.call(actual, name)
      found = exists ? (actual as any)[name] : undefined
    } else {
      exists = actual != null && name in Object(actual)
      found = exists ? (actual as any)[name] : undefined
    }
    const label = `have ${flags.nested ? 'nested ' : flags.own ? 'own ' : ''}property ${show(name)}`
    if (value.length === 0) {
      verify(this, exists, label)
    } else {
      verify(this, exists && deepEqual(found, value[0]), `${label} of ${show(value[0])}`, exists ? `got ${show(found)}` : undefined)
    }
    // chai moves the subject to the property's value for the rest of the chain
    return expectValue(found, { negate: flags.negate, deep: flags.deep })
  }
  ownProperty(name: string, ...value: unknown[]): Assertion {
    return derive(this, { own: true }).property(name, ...value)
  }
  haveOwnProperty(name: string, ...value: unknown[]): Assertion {
    return this.ownProperty(name, ...value)
  }
  /**
   * `.keys` — exactly these keys; `.any.keys` — at least one of them;
   * `.include.keys` / `.contain.keys` — all of them, others allowed.
   */
  keys(...names: unknown[]): Assertion {
    const { actual, flags } = this[STATE]
    const first = names[0]
    const want =
      names.length === 1 && Array.isArray(first)
        ? first.map(String)
        : names.length === 1 && first !== null && typeof first === 'object'
          ? Object.keys(first)
          : names.map(String)
    if (!want.length) misuse('keys needs at least one key')
    const kind = typeOf(actual)
    const have =
      kind === 'map' || kind === 'set'
        ? [...(actual as Map<unknown, unknown>).keys()].map(String)
        : actual !== null && typeof actual === 'object'
          ? Object.keys(actual)
          : misuse(`.keys needs an object, Map or Set, got ${show(actual)}`)
    let pass: boolean
    if (flags.any) pass = want.some((k) => have.includes(k))
    else if (flags.contains) pass = want.every((k) => have.includes(k))
    else pass = have.length === want.length && want.every((k) => have.includes(k))
    verify(this, pass, `have ${flags.any ? 'any of the' : flags.contains ? 'the' : 'exactly the'} keys ${show(want)}`)
    return this
  }
  key(...names: unknown[]): Assertion {
    return this.keys(...names)
  }
  /**
   * `.members` — the same elements in any order; `.include.members` — a subset;
   * `.ordered.members` — the same elements in this order.
   */
  members(list: unknown[]): Assertion {
    const { actual, flags } = this[STATE]
    if (!Array.isArray(actual)) misuse(`.members needs an array, got ${show(actual)}`)
    const want = Array.isArray(list) ? list : misuse(`.members needs an array to compare with, got ${show(list)}`)
    let pass: boolean
    if (flags.ordered) {
      pass = (flags.contains || actual.length === want.length) && want.every((w, i) => deepEqual(actual[i], w))
    } else if (flags.contains) {
      pass = want.every((w) => actual.some((h) => deepEqual(h, w)))
    } else {
      const pool = [...actual]
      pass =
        actual.length === want.length &&
        want.every((w) => {
          const i = pool.findIndex((h) => deepEqual(h, w))
          if (i < 0) return false
          pool.splice(i, 1)
          return true
        })
    }
    verify(this, pass, `have ${flags.contains ? 'the' : 'the same'}${flags.ordered ? ' ordered' : ''} members ${show(want)}`)
    return this
  }

  // --- functions ------------------------------------------------------------
  /** Asserts the target function throws when invoked (optionally with a message
   *  substring or matching RegExp). */
  throw(matcher?: string | RegExp): Assertion {
    const { actual } = this[STATE]
    if (typeof actual !== 'function') misuse(`.throw needs a function, got ${show(actual)}`)
    let threw = false
    let caught: unknown
    try {
      const fn = actual as () => unknown
      fn()
    } catch (err) {
      threw = true
      caught = err
    }
    let pass = threw
    if (threw && matcher != null) {
      const message = isErrorLike(caught) ? caught.message : String(caught)
      // Duck-type the RegExp: a literal created inside the vm realm is NOT an
      // instanceof the host RegExp, so check for a `.test` method instead.
      pass = isRegExpLike(matcher) ? matcher.test(message) : message.includes(String(matcher))
    }
    verify(this, pass, `throw${matcher != null ? ` ${show(matcher)}` : ''}`)
    return this
  }
  throws(matcher?: string | RegExp): Assertion {
    return this.throw(matcher)
  }
  Throw(matcher?: string | RegExp): Assertion {
    return this.throw(matcher)
  }

  // --- responses: pm.response and pm.sendRequest results ---------------------
  /** `status(200)` checks the code, `status('OK')` the reason phrase. */
  status(code: number | string): Assertion {
    const r = needResponse(this, 'status')
    const pass = typeof code === 'number' ? r.code === code : r.status === String(code)
    verify(this, pass, `have status ${show(code)}`, `got ${r.code}${r.status ? ` ${r.status}` : ''}`)
    return this
  }
  header(name: string, ...value: unknown[]): Assertion {
    const r = needResponse(this, 'header')
    const got = r.headers.get(String(name))
    if (value.length === 0) {
      verify(this, got !== undefined, `have header ${show(name)}`)
    } else {
      const want = value[0]
      const pass = got !== undefined && (isRegExpLike(want) ? want.test(got) : got === String(want))
      verify(this, pass, `have header ${show(name)} of ${show(want)}`, got === undefined ? 'header missing' : `got ${show(got)}`)
    }
    return this
  }
  /** No argument: the body is not empty; a string: equals it; a RegExp: matches. */
  body(...expected: unknown[]): Assertion {
    const text = needResponse(this, 'body').text()
    if (expected.length === 0) verify(this, text.length > 0, 'have a body')
    else if (isRegExpLike(expected[0])) verify(this, expected[0].test(text), `have a body matching ${String(expected[0])}`)
    else verify(this, text === String(expected[0]), `have body ${show(expected[0])}`)
    return this
  }
  /**
   * Postman's `jsonBody`: no argument — the body is JSON; a path — it exists
   * (`'data.items[0].id'`); a path and a value — it deep-equals the value;
   * an object — the whole body deep-equals it.
   */
  jsonBody(...args: unknown[]): Assertion {
    const r = needResponse(this, 'jsonBody')
    let data: unknown
    try {
      data = r.json()
    } catch {
      verify(this, false, 'have a JSON body')
      return this
    }
    if (args.length === 0) {
      verify(this, true, 'have a JSON body')
    } else if (typeof args[0] === 'string') {
      const { exists, value } = walkPath(data, args[0])
      if (args.length === 1) verify(this, exists, `have JSON body path ${show(args[0])}`)
      else
        verify(this, exists && deepEqual(value, args[1]), `have JSON body path ${show(args[0])} of ${show(args[1])}`, exists ? `got ${show(value)}` : 'path missing')
    } else {
      verify(this, deepEqual(data, args[0]), `have JSON body ${show(args[0])}`)
    }
    return this
  }
  jsonSchema(): Assertion {
    return misuse('jsonSchema is not supported by Relay yet — check the fields with pm.expect instead')
  }
  /** Valid JSON body. Readable as a property (Postman) and callable (older Relay scripts). */
  get json(): Chainable {
    const r = needResponse(this, 'json')
    let pass = true
    try {
      r.json()
    } catch {
      pass = false
    }
    verify(this, pass, 'have a JSON body')
    return chainable(this, () => this)
  }
  get html(): Assertion {
    const type = needResponse(this, 'html').headers.get('content-type') ?? ''
    verify(this, /html/i.test(type), 'be HTML', `content-type ${show(type)}`)
    return this
  }
  get xml(): Assertion {
    const type = needResponse(this, 'xml').headers.get('content-type') ?? ''
    verify(this, /xml/i.test(type), 'be XML', `content-type ${show(type)}`)
    return this
  }
  get withBody(): Assertion {
    verify(this, needResponse(this, 'withBody').text().length > 0, 'have a body')
    return this
  }
  get success(): Assertion {
    return statusIs(this, 'successful (2xx)', (c) => c >= 200 && c < 300)
  }
  get info(): Assertion {
    return statusIs(this, 'informational (1xx)', (c) => c >= 100 && c < 200)
  }
  get redirection(): Assertion {
    return statusIs(this, 'a redirection (3xx)', (c) => c >= 300 && c < 400)
  }
  get clientError(): Assertion {
    return statusIs(this, 'a client error (4xx)', (c) => c >= 400 && c < 500)
  }
  get serverError(): Assertion {
    return statusIs(this, 'a server error (5xx)', (c) => c >= 500 && c < 600)
  }
  get error(): Assertion {
    return statusIs(this, 'an error (4xx or 5xx)', (c) => c >= 400 && c < 600)
  }
  get accepted(): Assertion {
    return statusIs(this, 'accepted (202)', (c) => c === 202)
  }
  get badRequest(): Assertion {
    return statusIs(this, 'a bad request (400)', (c) => c === 400)
  }
  get unauthorized(): Assertion {
    return statusIs(this, 'unauthorized (401)', (c) => c === 401)
  }
  get forbidden(): Assertion {
    return statusIs(this, 'forbidden (403)', (c) => c === 403)
  }
  get notFound(): Assertion {
    return statusIs(this, 'not found (404)', (c) => c === 404)
  }
  get rateLimited(): Assertion {
    return statusIs(this, 'rate limited (429)', (c) => c === 429)
  }
}

/** An Error from either realm — one thrown inside the vm context is not an
 *  `instanceof Error` of the host, so it is recognised by shape as well. */
function isErrorLike(v: unknown): v is { name?: string; message: string } {
  if (typeof v !== 'object' || v === null) return false
  const e = v as { message?: unknown; stack?: unknown }
  return typeof e.message === 'string' && (v instanceof Error || typeof e.stack === 'string')
}

function json(v: unknown): string {
  // Error fields are non-enumerable, so JSON.stringify(err) is "{}" — which is
  // all `console.log(error)` used to print for a failed pm.sendRequest.
  if (isErrorLike(v)) return `${v.name || 'Error'}: ${v.message}`
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

/** One Postman key/value entry (`urlencoded`, `formdata`). */
interface PostmanParam {
  key?: unknown
  value?: unknown
  disabled?: boolean
  type?: string
}

/** A Postman request body, in every mode a script is likely to use. */
type SendRequestBody =
  | string
  | {
      mode?: string
      raw?: string
      urlencoded?: PostmanParam[] | Record<string, unknown> | string
      formdata?: PostmanParam[] | Record<string, unknown>
      graphql?: { query?: string; variables?: unknown }
      options?: { raw?: { language?: string } }
    }

/** A request accepted by pm.sendRequest (string URL or a Postman-like object). */
type SendRequestInput =
  | string
  | {
      url?: string
      method?: string
      header?: Array<{ key: string; value: string }> | Record<string, string>
      body?: SendRequestBody
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
 * Settings for a script that arrived without any — the unit tests call the
 * sandbox directly, and a payload built by an older renderer has no `settings`.
 */
const SEND_REQUEST_DEFAULTS: RequestSettings = {
  timeoutMs: 30000,
  followRedirects: true,
  maxRedirects: 10,
  rejectUnauthorized: true
}

const RAW_LANGUAGES: readonly RawLanguage[] = ['json', 'text', 'xml', 'html', 'javascript']

/** A parameter value as it goes on the wire: no "undefined", no "[object Object]". */
function paramValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') return json(v)
  return String(v)
}

/** Postman accepts a list of {key, value, disabled}, a plain object, or (for
 *  urlencoded) an already-encoded string. */
function paramsOf(source: unknown): KV[] {
  if (Array.isArray(source)) {
    return (source as PostmanParam[])
      .filter((p) => p && p.key != null && String(p.key) !== '')
      .map((p) => ({ key: String(p.key), value: paramValue(p.value), enabled: p.disabled !== true }))
  }
  if (typeof source === 'string') {
    return [...new URLSearchParams(source)].map(([key, value]) => ({ key, value, enabled: true }))
  }
  if (source && typeof source === 'object') {
    return Object.entries(source as Record<string, unknown>).map(([key, value]) => ({ key, value: paramValue(value), enabled: true }))
  }
  return []
}

/**
 * The engine body for a pm.sendRequest body. Only `raw` used to be understood,
 * so the most common token call there is — `mode: 'urlencoded'` with
 * client_id / client_secret / grant_type — went out with NO body at all and the
 * auth server answered 400.
 */
function bodyOf(body: SendRequestBody | undefined): RequestBody | null {
  if (body == null) return null
  if (typeof body === 'string') return { type: 'raw', language: 'text', text: body }
  switch (body.mode) {
    case 'raw': {
      if (typeof body.raw !== 'string') return null
      const wanted = body.options?.raw?.language as RawLanguage | undefined
      return { type: 'raw', language: wanted && RAW_LANGUAGES.includes(wanted) ? wanted : 'text', text: body.raw }
    }
    case 'urlencoded':
      return { type: 'urlencoded', items: paramsOf(body.urlencoded) }
    case 'formdata':
      // Text parts only. A file part would let a script — possibly from an
      // imported collection — read any local file and upload it.
      return {
        type: 'formdata',
        items: paramsOf(
          Array.isArray(body.formdata) ? (body.formdata as PostmanParam[]).filter((p) => p?.type !== 'file') : body.formdata
        ).map((p) => ({ key: p.key, value: p.value, enabled: p.enabled, type: 'text' as const }))
      }
    case 'graphql': {
      const variables = body.graphql?.variables
      return {
        type: 'graphql',
        query: String(body.graphql?.query ?? ''),
        variables: typeof variables === 'string' ? variables : variables == null ? '' : json(variables)
      }
    }
    default:
      // Postman's raw mode can be implied by a bare `raw` field.
      return typeof body.raw === 'string' ? { type: 'raw', language: 'text', text: body.raw } : null
  }
}

/**
 * Turn a pm.sendRequest argument into a spec for the app's own engine.
 * Exported for the tests: this mapping is where a dropped setting would hide.
 */
export function buildSendRequestSpec(input: SendRequestInput, settings?: RequestSettings): RequestSpec {
  let url: string
  let method = 'GET'
  const headers: Record<string, string> = {}
  let body: RequestBody | null = null

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
    body = bodyOf(input.body)
  }

  if (!url) throw new Error('pm.sendRequest: a URL is required')

  // A hand-written `multipart/form-data` header has no boundary, and the one the
  // engine generates must win or the server cannot split the parts.
  if (body?.type === 'formdata') {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-type' && /^multipart\/form-data/i.test(headers[key])) delete headers[key]
    }
  }

  // GET/HEAD carry no body — the engine would refuse one anyway.
  const carriesBody = body != null && method !== 'GET' && method !== 'HEAD'
  return {
    method: method as HttpMethod,
    url,
    query: [],
    headers: Object.entries(headers).map(([key, value]) => ({ key, value, enabled: true })),
    // The body's language/mode only decides the default Content-Type, and only
    // when the script did not set one itself.
    body: carriesBody && body ? body : { type: 'none' },
    auth: { type: 'none' },
    settings: settings ?? SEND_REQUEST_DEFAULTS
  }
}

/**
 * Perform a real HTTP request from inside the sandbox through the app's own
 * engine, so a script honours the same TLS strictness, CA bundle, proxy, client
 * certificates and timeout as a request sent from the UI. The cookie jar is
 * still not applied: pm.sendRequest sends no stored cookies.
 */
async function performSendRequest(input: SendRequestInput, settings?: RequestSettings): Promise<SendRequestResponse> {
  const result = await runRequest(buildSendRequestSpec(input, settings), { requestId: `pm-send-${Date.now()}` })
  // A transport failure (TLS, DNS, timeout) is an error for the script rather
  // than a response with status 0 — Postman rejects here too.
  if (result.error) throw new Error(result.error.message)
  const textBody =
    result.body.text ?? (result.body.base64 ? Buffer.from(result.body.base64, 'base64').toString('utf8') : '')

  return assertable({
    code: result.status,
    status: result.statusText,
    responseTime: result.timings.totalMs,
    headers: {
      get: (name: string) => result.headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
    },
    text: () => textBody,
    json: () => JSON.parse(textBody)
  })
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
  const asyncErrors: string[] = []
  activeRun = { logs, errors: asyncErrors }
  pendingWork = false
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
    ? assertable({
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
        }
      })
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
    expect: Object.assign((actual: unknown) => expectValue(actual), {
      fail: (message?: string): never => {
        throw new AssertionError(message ?? 'expect.fail()')
      }
    }),
    // pm.sendRequest(urlOrReq, callback?) — a real HTTP request through the app's
    // engine, with this run's network settings. Calls back (err, res)
    // Postman-style and also returns a promise. The cookie jar is not applied.
    sendRequest: (
      input: SendRequestInput,
      cb?: (err: Error | null, res?: SendRequestResponse) => void
    ): Promise<SendRequestResponse> => {
      const p = performSendRequest(input, payload.settings)
      // Track the callback chain (not just the raw request) so the async-settle
      // window also waits for work the callback does (e.g. setting a variable).
      if (typeof cb === 'function') {
        pendingRequests.push(
          p.then(
            (res) => cb(null, res),
            (err) => cb(err instanceof Error ? err : new Error(String(err)))
            // The callback itself threw: report it rather than swallow it.
          ).catch((err) => void recordAsyncScriptError(err instanceof Error ? err.message : String(err)))
        )
      } else {
        // The script owns this promise, so a rejection it handles is its own
        // business; log it, and let the process-level handler mark it fatal if
        // nothing handled it at all.
        pendingRequests.push(
          p.catch((err) => void recordAsyncScriptError(err instanceof Error ? err.message : String(err), false))
        )
      }
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
    activeRun = null
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
    // The script's own throw wins; otherwise the first async failure is what the
    // user needs to see (an unhandled rejection, a throwing callback, a request
    // that never came back).
    const reported = error ?? asyncErrors[0]
    if (reported != null) result.error = reported
    return result
  }

  try {
    runInContext(payload.code, context, { timeout: 3000, displayErrors: true })
  } catch (err) {
    // A script that fired a request and then threw leaves that request running.
    pendingWork = pendingRequests.length > 0 || pendingTests.length > 0
    return finalize(err instanceof Error ? err.message : String(err))
  }

  // Settle any async pm.test(...) bodies and in-flight pm.sendRequest() calls,
  // bounded so a non-resolving promise can't hang the run. A script that fetches
  // a token gets the request timeout it would have had in the UI: 3 seconds is
  // plenty for assertions, but it cuts off a real auth round-trip.
  const pending = [...pendingTests, ...pendingRequests]
  if (pending.length) {
    const budget = pendingRequests.length
      ? Math.min((payload.settings?.timeoutMs ?? SEND_REQUEST_DEFAULTS.timeoutMs) + 2000, 20000)
      : 3000
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.allSettled(pending).then(() => {
        done = true
      }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budget)
      })
    ])
    if (timer) clearTimeout(timer)
    // Giving up quietly here is how a missing token turns into a puzzling 401
    // two steps later.
    if (!done) {
      pendingWork = true
      recordAsyncScriptError(`Script did not finish within ${budget} ms — a pm.sendRequest never came back`)
    }
  }

  return finalize()
}
