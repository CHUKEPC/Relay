import { useEffect, useState } from 'react'
import type { AppIconDef } from '@shared/app-icon'
import { appIconDataUrl } from '@renderer/lib/app-icon-render'

/** Drawn icons by size and description — the cards redraw the same ones a lot. */
const cache = new Map<string, string>()
const CACHE_MAX = 300

/** `def` drawn at `px` pixels as a data URL (null while drawing). */
export function useAppIconUrl(def: AppIconDef | null, px: number): string | null {
  const key = def ? `${px}:${JSON.stringify(def)}` : ''
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null)
  useEffect(() => {
    if (!def) {
      setUrl(null)
      return
    }
    const hit = cache.get(key)
    if (hit) {
      setUrl(hit)
      return
    }
    let live = true
    appIconDataUrl(def, px)
      .then((u) => {
        if (cache.size > CACHE_MAX) cache.clear()
        cache.set(key, u)
        if (live) setUrl(u)
      })
      .catch(() => live && setUrl(null))
    return () => {
      live = false
    }
    // `key` stands for `def` and `px`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return url
}

/** An app icon shown at `size` CSS pixels, drawn at twice that for sharp edges. */
export function AppIconImage({ def, size, className }: { def: AppIconDef | null; size: number; className?: string }): JSX.Element {
  const url = useAppIconUrl(def, size * 2)
  return url ? (
    <img className={className} src={url} width={size} height={size} alt="" draggable={false} />
  ) : (
    <span className={className} style={{ display: 'inline-block', width: size, height: size }} aria-hidden />
  )
}
