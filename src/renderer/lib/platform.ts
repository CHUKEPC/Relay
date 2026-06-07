/**
 * Platform helpers for the renderer. Used to show the correct modifier key in
 * shortcut hints (⌘ on macOS, Ctrl on Windows/Linux).
 */
export const isMac = typeof window !== 'undefined' && window.api?.platform === 'darwin'

/** Modifier label for the current platform. */
export const MOD = isMac ? '⌘' : 'Ctrl'

/** A compact shortcut label, e.g. kbd('K') → "⌘K" (mac) or "Ctrl+K" (win/linux). */
export function kbd(key: string): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`
}
