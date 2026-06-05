import type { StorageKey, StorageMap } from '@shared/ipc-contract'

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingValues = new Map<string, unknown>()

/** Debounced persistence to main (which itself debounces disk writes). */
export function persist<K extends StorageKey>(key: K, value: StorageMap[K], ms = 250): void {
  pendingValues.set(key, value)
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      pendingValues.delete(key)
      void window.api.storageSave(key, value)
    }, ms)
  )
}

/** Flush all debounced writes immediately (call before the window unloads/quits). */
export function flushPersist(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  for (const [key, value] of pendingValues) {
    void window.api.storageSave(key as StorageKey, value as StorageMap[StorageKey])
  }
  pendingValues.clear()
}

/**
 * Flush pending writes and AWAIT them. Use before switching workspaces so the
 * outgoing workspace's edits land in main BEFORE its store is re-pointed (a fire-
 * and-forget flush could otherwise write into the newly-activated workspace).
 */
export async function flushPersistAndWait(): Promise<void> {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  const writes: Promise<void>[] = []
  for (const [key, value] of pendingValues) {
    writes.push(window.api.storageSave(key as StorageKey, value as StorageMap[StorageKey]))
  }
  pendingValues.clear()
  await Promise.all(writes)
}
