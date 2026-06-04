import type { StorageKey, StorageMap } from '@shared/ipc-contract'

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Debounced persistence to main (which itself debounces disk writes). */
export function persist<K extends StorageKey>(key: K, value: StorageMap[K], ms = 250): void {
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)
  timers.set(
    key,
    setTimeout(() => {
      void window.api.storageSave(key, value)
    }, ms)
  )
}
