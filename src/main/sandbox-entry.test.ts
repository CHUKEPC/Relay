import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * The sandbox children (pm.* scripts, user plugins) are the Electron binary run
 * as plain Node, where the built-in `electron` module does not exist. A single
 * value import of `electron` anywhere in this module graph therefore kills every
 * script and every plugin — but only in a PACKAGED build, because in
 * development the `electron` npm package is on disk and the require resolves.
 * That is exactly how it shipped unnoticed once, so it is guarded here.
 */
const ROOT = resolve(__dirname, '../..')
const ENTRY = resolve(__dirname, 'sandbox-entry.ts')

const ALIASES: Record<string, string> = {
  '@shared': join(ROOT, 'src/shared'),
  '@main': join(ROOT, 'src/main'),
  '@renderer': join(ROOT, 'src/renderer')
}

/**
 * Comments out, strings kept — a docstring that *mentions* `require('electron')`
 * (several here do, explaining this very trap) must not read as an import.
 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    if (quote) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      out += c
      i++
      continue
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

/** Every module specifier imported (or re-exported) by a file. */
function specifiersOf(source: string): string[] {
  const out: string[] = []
  const re = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) out.push(m[1])
  const bare = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
  while ((m = bare.exec(source))) out.push(m[1])
  const required = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = required.exec(source))) out.push(m[1])
  return out
}

/** Path on disk for a relative or aliased specifier; null for a package. */
function fileFor(fromFile: string, spec: string): string | null {
  let base: string | null = null
  if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else {
    for (const [alias, dir] of Object.entries(ALIASES)) {
      if (spec === alias || spec.startsWith(`${alias}/`)) {
        base = join(dir, spec.slice(alias.length))
        break
      }
    }
  }
  if (!base) return null
  for (const candidate of [`${base}.ts`, join(base, 'index.ts'), base]) {
    if (candidate.endsWith('.ts') && existsSync(candidate)) return candidate
  }
  return null
}

/** Does this file import `electron` for its VALUE (not just its types)? */
function importsElectronValue(source: string): boolean {
  const lines = source.split('\n')
  return lines.some((line) => {
    if (!/from\s+['"]electron['"]|require\(\s*['"]electron['"]\s*\)/.test(line)) return false
    return !/^\s*import\s+type\b/.test(line)
  })
}

function graphFrom(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = stripComments(readFileSync(file, 'utf8'))
    for (const spec of specifiersOf(source)) {
      const next = fileFor(file, spec)
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return [...seen]
}

describe('the sandbox children bundle', () => {
  it('has an entry of its own, separate from the app', () => {
    expect(existsSync(ENTRY)).toBe(true)
    const source = readFileSync(ENTRY, 'utf8')
    expect(source).toMatch(/startSandboxHost/)
    expect(source).toMatch(/startPluginSandboxHost/)
  })

  it('never imports electron for its value, anywhere in the graph', () => {
    const offenders = graphFrom(ENTRY).filter((file) => importsElectronValue(stripComments(readFileSync(file, 'utf8'))))
    expect(offenders.map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'))).toEqual([])
  })

  it('reaches both sandbox hosts (the guard above is actually covering them)', () => {
    const graph = graphFrom(ENTRY).map((f) => f.replace(/\\/g, '/'))
    expect(graph.some((f) => f.endsWith('src/main/scripting/index.ts'))).toBe(true)
    expect(graph.some((f) => f.endsWith('src/main/plugins/host.ts'))).toBe(true)
    // …and through them the http engine, which the scripts' pm.sendRequest uses.
    expect(graph.some((f) => f.endsWith('src/main/http/engine.ts'))).toBe(true)
  })

  it('does not reach the app entry, which does import electron', () => {
    const graph = graphFrom(ENTRY).map((f) => f.replace(/\\/g, '/'))
    expect(graph.some((f) => f.endsWith('src/main/index.ts'))).toBe(false)
    expect(importsElectronValue(stripComments(readFileSync(join(ROOT, 'src/main/index.ts'), 'utf8')))).toBe(true)
  })
})
