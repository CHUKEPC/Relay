import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type MouseEvent as ReactMouseEvent } from 'react'
import { Icon } from './Icon'
import { trackDrag } from '@renderer/lib/drag'
import { sliderOf, type ScrollState } from '@renderer/lib/hscroll'
import { tr } from '@renderer/lib/i18n'
import '@renderer/styles/feat-hscroll.css'

const SAME = (a: ScrollState, b: ScrollState): boolean => a.left === b.left && a.width === b.width && a.view === b.view

/** Scroll `el` into the visible part of `row`, with a margin for the edge arrows. */
function reveal(row: HTMLElement, el: Element): void {
  const r = row.getBoundingClientRect()
  const e = el.getBoundingClientRect()
  const pad = 30
  if (e.left < r.left + pad) row.scrollLeft -= r.left + pad - e.left
  else if (e.right > r.right - pad) row.scrollLeft += e.right - (r.right - pad)
}

export interface HScrollProps extends HTMLAttributes<HTMLDivElement> {
  /** Class of the row itself (`req-tabs`, `resp-tabs`, `subbar`, …). */
  className: string
  /** When this changes, the row's `.on` item is scrolled into view (the selected tab). */
  revealKey?: unknown
}

/**
 * A toolbar row that keeps its natural width and scrolls sideways when the pane
 * is narrower than it: the mouse wheel scrolls it, an arrow at each clipped end
 * steps it, and a slim slider along the bottom edge shows where the view is and
 * drags it. Without these a hidden tab or button could only be reached with
 * Shift+wheel or a touchpad.
 */
export function HScroll({ className, revealKey, children, ...rest }: HScrollProps): JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)
  const [m, setM] = useState<ScrollState>({ left: 0, width: 0, view: 0 })

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const measure = (): void => {
      const next = { left: row.scrollLeft, width: row.scrollWidth, view: row.clientWidth }
      setM((prev) => (SAME(prev, next) ? prev : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    // Items change width without the row resizing: a count badge, a mode switch.
    const mo = new MutationObserver(measure)
    mo.observe(row, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] })
    // Vertical wheel scrolls the row sideways. Native listener with passive:false —
    // React's synthetic onWheel can't preventDefault reliably.
    const onWheel = (e: WheelEvent): void => {
      if (row.scrollWidth <= row.clientWidth + 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      row.scrollLeft += e.deltaY
      e.preventDefault()
    }
    row.addEventListener('scroll', measure, { passive: true })
    row.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      mo.disconnect()
      row.removeEventListener('scroll', measure)
      row.removeEventListener('wheel', onWheel)
    }
  }, [])

  useEffect(() => {
    const row = rowRef.current
    const on = row?.querySelector('.on')
    if (row && on) reveal(row, on)
  }, [revealKey])

  const { overflow, canStart, canEnd, thumb, offset, ratio } = sliderOf(m)

  const step = (dir: -1 | 1): void => {
    const row = rowRef.current
    if (row) row.scrollBy({ left: dir * Math.max(80, row.clientWidth * 0.7), behavior: 'smooth' })
  }

  /** Press on the slider: the thumb follows the mouse; a press beside it jumps there first. */
  const onTrackDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const row = rowRef.current
    if (!row || e.button !== 0) return
    e.preventDefault()
    const box = e.currentTarget.getBoundingClientRect()
    const onThumb = (e.target as HTMLElement).classList.contains('hscroll-thumb')
    if (!onThumb) row.scrollLeft = (e.clientX - box.left - thumb / 2) * ratio
    const startX = e.clientX
    const startLeft = row.scrollLeft
    trackDrag((ev) => {
      row.scrollLeft = startLeft + (ev.clientX - startX) * ratio
    })
  }

  return (
    <div className={`hscroll${overflow ? ' overflowing' : ''}`}>
      <div ref={rowRef} className={`${className} hscroll-row`} {...rest}>
        {children}
      </div>
      {canStart && (
        <button className="hscroll-arrow start" tabIndex={-1} onClick={() => step(-1)} title={tr('Прокрутить влево')} aria-label={tr('Прокрутить влево')}>
          <Icon name="chevL" size={13} />
        </button>
      )}
      {canEnd && (
        <button className="hscroll-arrow end" tabIndex={-1} onClick={() => step(1)} title={tr('Прокрутить вправо')} aria-label={tr('Прокрутить вправо')}>
          <Icon name="chevR" size={13} />
        </button>
      )}
      {overflow && (
        <div className="hscroll-track" onMouseDown={onTrackDown} aria-hidden>
          <div className="hscroll-thumb" style={{ width: thumb, transform: `translateX(${offset}px)` }} />
        </div>
      )}
    </div>
  )
}
