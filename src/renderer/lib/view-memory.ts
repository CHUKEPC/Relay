import { useLayoutEffect, type RefObject } from 'react'

/**
 * Scroll positions of views that are rebuilt when their tab is shown again
 * (the response body, the request body editor…). Switching tabs remounts them;
 * this keeps where each one was left, so coming back to a tab finds it as it
 * was instead of at the top.
 *
 * In memory only, keyed by `<tabId>:<view>`; a closed tab's keys are dropped.
 */
export interface ScrollPos {
  top: number
  left: number
}

const positions = new Map<string, ScrollPos>()
/** Plenty for every view of a large session; the oldest keys go first. */
const MAX_KEYS = 400

export function rememberScroll(key: string, pos: ScrollPos): void {
  if (positions.has(key)) positions.delete(key)
  positions.set(key, pos)
  if (positions.size > MAX_KEYS) positions.delete(positions.keys().next().value as string)
}

export function recallScroll(key: string): ScrollPos | null {
  return positions.get(key) ?? null
}

/** Drop everything remembered for a tab (it was closed). */
export function forgetViews(tabId: string): void {
  const prefix = `${tabId}:`
  for (const key of [...positions.keys()]) if (key.startsWith(prefix)) positions.delete(key)
}

/**
 * Keep a scrolling element's position under `key`: restored when the element
 * mounts (or the key changes), saved as it scrolls. A null key does nothing.
 */
export function useRememberedScroll(ref: RefObject<HTMLElement>, key: string | null): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !key) return
    const pos = recallScroll(key)
    el.scrollTop = pos?.top ?? 0
    el.scrollLeft = pos?.left ?? 0
    const onScroll = (): void => rememberScroll(key, { top: el.scrollTop, left: el.scrollLeft })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [ref, key])
}
