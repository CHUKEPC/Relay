/**
 * The single variable resolver used everywhere. `{{name}}` syntax with
 * Postman precedence (local → collection → environment → global) plus dynamic
 * `{{$...}}` built-ins. Unresolved tokens are left literal and reported so the
 * UI can flag them.
 */
import type { ResolvedToken, VariableDef, VariableScope } from './types'

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g

export function flattenVariables(defs: VariableDef[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!defs) return out
  for (const d of defs) {
    if (d.enabled && d.key) out[d.key] = d.value
  }
  return out
}

let guidCounter = 0

function randomInt(min = 0, max = 1000): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function uuidv4(): string {
  // RFC4122-ish v4; good enough for {{$guid}}/{{$randomUUID}}.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Resolve a single dynamic `$` variable, or return null if it is not one we know. */
export function resolveDynamic(name: string): string | null {
  if (!name.startsWith('$')) return null
  const now = Date.now()
  switch (name) {
    case '$guid':
    case '$randomUUID':
      return uuidv4()
    case '$timestamp':
      return String(Math.floor(now / 1000))
    case '$isoTimestamp':
      return new Date(now).toISOString()
    case '$randomInt':
      return String(randomInt(0, 1000))
    case '$randomBoolean':
      return Math.random() < 0.5 ? 'true' : 'false'
    case '$randomFirstName':
      return pick(['Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Dennis', 'Barbara'])
    case '$randomEmail':
      return `user${randomInt(1, 9999)}@example.com`
    case '$randomColor':
      return pick(['red', 'green', 'blue', 'amber', 'violet', 'teal'])
    case '$counter':
      return String(guidCounter++)
    default:
      return null
  }
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)]
}

/** Own-property check — NOT `in`, which would match inherited Object.prototype
 *  members (constructor, toString, __proto__, ...) and return a function value
 *  that later code would try to `.replace()` on, throwing. */
function hasOwn(obj: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function lookup(name: string, scope: VariableScope): ResolvedToken {
  const dyn = resolveDynamic(name)
  if (dyn !== null) return { name, value: dyn, source: 'dynamic' }
  if (scope.local && hasOwn(scope.local, name)) return { name, value: scope.local[name], source: 'local' }
  if (scope.collection && hasOwn(scope.collection, name))
    return { name, value: scope.collection[name], source: 'collection' }
  if (scope.environment && hasOwn(scope.environment, name))
    return { name, value: scope.environment[name], source: 'environment' }
  if (scope.global && hasOwn(scope.global, name)) return { name, value: scope.global[name], source: 'global' }
  return { name, value: null, source: 'unresolved' }
}

export interface ResolveStringResult {
  value: string
  tokens: ResolvedToken[]
  unresolved: string[]
}

/**
 * Resolve all `{{var}}` tokens in `input`. Supports nested resolution (a variable
 * whose value itself contains `{{...}}`) up to `maxDepth` levels, while detecting
 * reference cycles (a self- or mutually-referential variable is left literal and
 * reported as unresolved instead of being expanded into garbage).
 */
export function resolveString(input: string, scope: VariableScope, maxDepth = 10): ResolveStringResult {
  const tokens: ResolvedToken[] = []
  const unresolved = new Set<string>()

  // `seen` is the set of variable names currently being expanded on this branch,
  // so a cycle (a -> a, a -> b -> a) is caught. A fresh regex per call avoids the
  // shared-lastIndex reentrancy hazard of recursing on one global regex.
  const expand = (str: string, seen: Set<string>, depth: number, collect: boolean): string => {
    if (depth > maxDepth) {
      const re = /\{\{\s*([^}]+?)\s*\}\}/g
      let m: RegExpExecArray | null
      while ((m = re.exec(str)) !== null) unresolved.add(m[1].trim())
      return str
    }
    const re = /\{\{\s*([^}]+?)\s*\}\}/g
    return str.replace(re, (whole, rawName: string) => {
      const name = rawName.trim()
      if (seen.has(name)) {
        unresolved.add(name) // cycle — leave literal
        if (collect) tokens.push({ name, value: null, source: 'unresolved' })
        return whole
      }
      const t = lookup(name, scope)
      if (t.value === null) {
        unresolved.add(name)
        if (collect) tokens.push(t)
        return whole // leave literal
      }
      const resolved = expand(t.value, new Set([...seen, name]), depth + 1, false)
      if (collect) tokens.push({ name, value: resolved, source: t.source })
      return resolved
    })
  }

  const value = expand(input ?? '', new Set(), 0, true)
  return { value, tokens, unresolved: [...unresolved] }
}

/** Convenience: resolve and return only the string. */
export function interpolate(input: string, scope: VariableScope): string {
  return resolveString(input, scope).value
}

/** Extract the variable names referenced by a string (for highlighting). */
export function extractTokens(input: string): string[] {
  const names: string[] = []
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(input)) !== null) names.push(m[1].trim())
  return names
}
