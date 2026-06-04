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

function lookup(name: string, scope: VariableScope): ResolvedToken {
  const dyn = resolveDynamic(name)
  if (dyn !== null) return { name, value: dyn, source: 'dynamic' }
  if (scope.local && name in scope.local) return { name, value: scope.local[name], source: 'local' }
  if (scope.collection && name in scope.collection)
    return { name, value: scope.collection[name], source: 'collection' }
  if (scope.environment && name in scope.environment)
    return { name, value: scope.environment[name], source: 'environment' }
  if (scope.global && name in scope.global) return { name, value: scope.global[name], source: 'global' }
  return { name, value: null, source: 'unresolved' }
}

export interface ResolveStringResult {
  value: string
  tokens: ResolvedToken[]
  unresolved: string[]
}

/**
 * Resolve all `{{var}}` tokens in `input`. Supports up to `maxDepth` levels of
 * nested resolution (a variable whose value itself contains `{{...}}`).
 */
export function resolveString(input: string, scope: VariableScope, maxDepth = 5): ResolveStringResult {
  const tokens: ResolvedToken[] = []
  const unresolved = new Set<string>()
  let value = input ?? ''

  for (let depth = 0; depth < maxDepth; depth++) {
    let changed = false
    value = value.replace(TOKEN_RE, (whole, rawName: string) => {
      const name = rawName.trim()
      const t = lookup(name, scope)
      if (depth === 0) tokens.push(t)
      if (t.value === null) {
        unresolved.add(name)
        return whole // leave literal
      }
      changed = true
      return t.value
    })
    if (!changed) break
  }

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
