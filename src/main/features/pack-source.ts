/**
 * Turning "what the user picked" into "a folder holding a valid plugin.json".
 *
 * Kept free of Electron imports so the tricky parts — archive traversal, path
 * escapes, manifest validation — are unit-testable without an Electron runtime.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { unzipSync } from 'fflate'
import { isCapability, type Capability, type FeaturePluginManifest } from '@shared/features'

export const MANIFEST = 'plugin.json'
export const MANIFEST_MAX_BYTES = 64 * 1024
const ZIP_MAX_BYTES = 16 * 1024 * 1024

/** A staged source folder; `temp` is set when it must be cleaned up afterwards. */
export interface PackSource {
  dir: string
  temp?: string
}

export type PackSourceResult = PackSource | { error: string }

/** Folder of a picked `plugin.json` (or the folder itself when one was picked). */
export function dirOfManifest(picked: string): PackSourceResult {
  const normalized = picked.replace(/\\/g, '/')
  const dir = normalized.endsWith(`/${MANIFEST}`) ? dirname(picked) : picked
  if (!existsSync(join(dir, MANIFEST))) return { error: `в папке нет ${MANIFEST}` }
  return { dir }
}

/**
 * Extract a `.zip` into a temp folder and return the folder holding the
 * manifest. Entries with absolute paths or `..` segments are dropped: an
 * archive must never be able to write outside its own extraction root.
 */
export function unpackZip(file: string): PackSourceResult {
  const bytes = readFileSync(file)
  if (bytes.length > ZIP_MAX_BYTES) return { error: 'архив слишком большой' }
  const files = unzipSync(new Uint8Array(bytes))
  const temp = mkdtempSync(join(tmpdir(), 'relay-pack-'))
  let manifestDir: string | null = null

  for (const [name, data] of Object.entries(files)) {
    if (name.startsWith('/') || name.startsWith('\\') || name.split(/[\\/]/).includes('..')) continue
    const target = join(temp, name)
    if (!resolve(target).startsWith(resolve(temp))) continue
    if (name.endsWith('/')) {
      mkdirSync(target, { recursive: true })
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
    if (name.endsWith(MANIFEST)) manifestDir = dirname(target)
  }

  if (!manifestDir) {
    rmSync(temp, { recursive: true, force: true })
    return { error: `в архиве нет ${MANIFEST}` }
  }
  return { dir: manifestDir, temp }
}

/** Pick the right staging strategy for what the user chose. */
export function stageSource(path: string): PackSourceResult {
  return path.toLowerCase().endsWith('.zip') ? unpackZip(path) : dirOfManifest(path)
}

export interface ValidPack {
  id: string
  capabilities: Capability[]
}

/** Read and check a staged manifest: a usable id and at least one capability. */
export function validateManifest(dir: string): ValidPack | { error: string } {
  const file = join(dir, MANIFEST)
  try {
    if (statSync(file).size > MANIFEST_MAX_BYTES) return { error: 'манифест слишком большой' }
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<FeaturePluginManifest>
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    // The id becomes a folder name, so keep it to a plain, safe token.
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id) || id.includes('..')) return { error: 'в манифесте нет корректного id' }
    const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities.filter(isCapability) : []
    if (!capabilities.length) return { error: 'манифест не объявляет ни одной возможности' }
    return { id, capabilities }
  } catch (err) {
    return { error: `манифест не читается: ${(err as Error).message}` }
  }
}
