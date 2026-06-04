import { mkdirSync } from 'node:fs'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { StorageKey, StorageMap } from '@shared/ipc-contract'

/**
 * Tiny local-first JSON document store. One file per key under a data dir in
 * userData. Writes are debounced and atomic (temp file + rename) to avoid
 * corruption. No native modules — keeps the build reliable.
 */
export class JsonStore {
  private dir: string
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private pending = new Map<string, unknown>()
  private readonly debounceMs: number

  constructor(dir: string, debounceMs = 300) {
    this.dir = dir
    this.debounceMs = debounceMs
    mkdirSync(this.dir, { recursive: true })
  }

  private fileFor(key: string): string {
    return join(this.dir, `${key}.json`)
  }

  async load<K extends StorageKey>(key: K): Promise<StorageMap[K] | null> {
    // Return an unflushed pending value if present (most recent state).
    if (this.pending.has(key)) return this.pending.get(key) as StorageMap[K]
    try {
      const raw = await readFile(this.fileFor(key), 'utf8')
      return JSON.parse(raw) as StorageMap[K]
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      console.error(`[storage] failed to read ${key}:`, (err as Error).message)
      return null
    }
  }

  save<K extends StorageKey>(key: K, value: StorageMap[K]): void {
    this.pending.set(key, value)
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)
    this.timers.set(
      key,
      setTimeout(() => {
        void this.flush(key)
      }, this.debounceMs)
    )
  }

  private async flush(key: string): Promise<void> {
    const timer = this.timers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(key)
    }
    if (!this.pending.has(key)) return
    const value = this.pending.get(key)
    this.pending.delete(key)
    const file = this.fileFor(key)
    const tmp = `${file}.${process.pid}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
      await rename(tmp, file)
    } catch (err) {
      console.error(`[storage] failed to write ${key}:`, (err as Error).message)
    }
  }

  /** Flush everything synchronously-ish (awaited) — call on app quit. */
  async flushAll(): Promise<void> {
    const keys = [...this.pending.keys()]
    await Promise.all(keys.map((k) => this.flush(k)))
  }
}
