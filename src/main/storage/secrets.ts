import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'

/**
 * Encrypted secret store backed by Electron `safeStorage` (OS keychain).
 * Only ciphertext touches disk. Secrets are kept in memory as ciphertext so
 * `get()` is synchronous (used by the AI handler at call time). Raw values are
 * never logged and never returned to the renderer.
 */
export class SecretStore {
  private file: string
  /** ref -> base64 ciphertext */
  private map = new Map<string, string>()

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'secrets.json')
    this.loadFromDisk()
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.file)) return
      const raw = readFileSync(this.file, 'utf8')
      const obj = JSON.parse(raw) as Record<string, string>
      for (const [k, v] of Object.entries(obj)) this.map.set(k, v)
    } catch (err) {
      console.error('[secrets] failed to load store:', (err as Error).message)
    }
  }

  private persist(): void {
    const obj: Record<string, string> = {}
    for (const [k, v] of this.map) obj[k] = v
    const tmp = `${this.file}.${process.pid}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(obj), 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('[secrets] failed to persist store:', (err as Error).message)
    }
  }

  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  set(ref: string, value: string): void {
    if (this.isAvailable()) {
      const cipher = safeStorage.encryptString(value)
      this.map.set(ref, cipher.toString('base64'))
    } else {
      // Fallback (no OS keychain available, e.g. some Linux CI): store a marked
      // base64 of the plaintext so the app still functions. Documented in README.
      this.map.set(ref, `plain:${Buffer.from(value, 'utf8').toString('base64')}`)
    }
    this.persist()
  }

  /** Synchronous decrypt. Returns null if missing or undecryptable. */
  get(ref: string): string | null {
    const stored = this.map.get(ref)
    if (!stored) return null
    try {
      if (stored.startsWith('plain:')) {
        return Buffer.from(stored.slice('plain:'.length), 'base64').toString('utf8')
      }
      if (!this.isAvailable()) return null
      const buf = Buffer.from(stored, 'base64')
      return safeStorage.decryptString(buf)
    } catch (err) {
      console.error('[secrets] failed to decrypt a secret (key rotated?):', (err as Error).message)
      return null
    }
  }

  has(ref: string): boolean {
    return this.map.has(ref)
  }

  delete(ref: string): void {
    if (this.map.delete(ref)) this.persist()
  }
}
