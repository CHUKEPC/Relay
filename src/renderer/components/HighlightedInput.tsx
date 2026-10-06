import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent
} from 'react'
import { createPortal } from 'react-dom'
import type { VariableScope } from '@shared/types'
import { resolveString } from '@shared/interpolate'
import { Icon } from './Icon'
import { Tooltip } from './primitives'
import { useSecretNames } from '@renderer/lib/hooks'
import { applyVarSuggestion, suggestVars, varQueryAt, type VarQuery, type VarSuggestion } from '@renderer/lib/var-suggest'
import '@renderer/styles/feat-varsuggest.css'

import { tr } from '@renderer/lib/i18n'
interface Segment {
  text: string
  isVar: boolean
  resolved?: string | null
  source?: string
}

function parse(value: string, scope?: VariableScope): Segment[] {
  const segs: Segment[] = []
  const parts = value.split(/(\{\{[^}]+\}\})/g)
  for (const p of parts) {
    if (!p) continue
    if (/^\{\{[^}]+\}\}$/.test(p)) {
      const t = scope ? resolveString(p, scope).tokens[0] : undefined
      segs.push({ text: p, isVar: true, resolved: t?.value ?? null, source: t?.source })
    } else {
      segs.push({ text: p, isVar: false })
    }
  }
  return segs
}

/** Where the suggestion list is drawn (fixed, so table cells can't clip it). */
interface PopupBox {
  left: number
  top: number
  width: number
  /** the list opens upwards when there is no room below */
  above: boolean
}

const SOURCE_LABELS: Record<VarSuggestion['source'], string> = {
  local: 'данные',
  collection: 'коллекция',
  environment: 'окружение',
  global: 'глобальная',
  dynamic: 'динамическая'
}

const POPUP_MAX_HEIGHT = 240

export interface HighlightedInputProps {
  value: string
  onChange?: (v: string) => void
  placeholder?: string
  scope?: VariableScope
  mono?: boolean
  readOnly?: boolean
  spellCheck?: boolean
  className?: string
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void
  ariaLabel?: string
  /** Opt out of the `{{` suggestion list (read-only mirrors, filters, …). */
  noSuggest?: boolean
  /**
   * A value longer than the field gets «to the start» / «to the end» buttons at
   * its clipped ends, and the mouse wheel scrolls it sideways (the URL bar).
   */
  edgeNav?: boolean
}

/** Single-line input that highlights {{variables}} via a mirror layer, flags
 *  unresolved ones, shows resolution on hover, and completes `{{` as you type. */
export function HighlightedInput({
  value,
  onChange,
  placeholder,
  scope,
  mono = true,
  readOnly,
  spellCheck = false,
  className = '',
  onKeyDown,
  onPaste,
  ariaLabel,
  noSuggest = false,
  edgeNav = false
}: HighlightedInputProps) {
  const [scroll, setScroll] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  /** which ends of an over-long value are out of view (edgeNav) */
  const [clipped, setClipped] = useState({ start: false, end: false })

  const measureClip = useCallback(() => {
    const el = inputRef.current
    if (!el || !edgeNav) return
    const max = el.scrollWidth - el.clientWidth
    const start = max > 1 && el.scrollLeft > 1
    const end = max > 1 && el.scrollLeft < max - 1
    setClipped((p) => (p.start === start && p.end === end ? p : { start, end }))
  }, [edgeNav])

  useLayoutEffect(measureClip, [value, measureClip])

  useEffect(() => {
    const el = inputRef.current
    if (!el || !edgeNav) return
    const ro = new ResizeObserver(measureClip)
    ro.observe(el)
    // The wheel scrolls a long value sideways; passive:false so the page does not scroll too.
    const onWheel = (e: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth + 1) return
      el.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [edgeNav, measureClip])

  /** Put the caret at an end of the value; the field scrolls to show it. */
  const jump = (to: 'start' | 'end'): void => {
    const el = inputRef.current
    if (!el) return
    const pos = to === 'start' ? 0 : el.value.length
    el.focus()
    el.setSelectionRange(pos, pos)
    el.scrollLeft = to === 'start' ? 0 : el.scrollWidth
  }
  const segs = useMemo(() => parse(value, scope), [value, scope])
  const secrets = useSecretNames()

  const [query, setQuery] = useState<VarQuery | null>(null)
  const [items, setItems] = useState<VarSuggestion[]>([])
  const [box, setBox] = useState<PopupBox | null>(null)
  const [active, setActive] = useState(0)
  const open = query !== null && items.length > 0
  const suggestible = !noSuggest && !readOnly && !!onChange

  const close = useCallback(() => {
    setQuery(null)
    setItems([])
    setBox(null)
  }, [])

  /** Re-read the caret and decide whether a suggestion list is due. */
  const refresh = useCallback(
    (text: string, caret: number | null) => {
      if (!suggestible || caret === null) return close()
      const q = varQueryAt(text, caret)
      if (!q) return close()
      const found = suggestVars(q.query, scope, { secrets })
      if (!found.length) return close()
      const el = inputRef.current
      if (el) {
        const r = el.getBoundingClientRect()
        const below = window.innerHeight - r.bottom
        const above = below < POPUP_MAX_HEIGHT + 16 && r.top > below
        setBox({ left: r.left, top: above ? r.top - 4 : r.bottom + 4, width: Math.max(r.width, 240), above })
      }
      setQuery(q)
      setItems(found)
      // Always highlight the best match: the list is re-filtered on every
      // keystroke, and a highlight left over from an earlier reference would
      // quietly insert the wrong variable.
      setActive(0)
    },
    [close, scope, secrets, suggestible]
  )

  // A scroll or a resize moves the input out from under the list.
  useEffect(() => {
    if (!open) return
    const onAway = (): void => close()
    window.addEventListener('scroll', onAway, true)
    window.addEventListener('resize', onAway)
    return () => {
      window.removeEventListener('scroll', onAway, true)
      window.removeEventListener('resize', onAway)
    }
  }, [open, close])

  const accept = useCallback(
    (name: string) => {
      const el = inputRef.current
      if (!el || !query) return
      const next = applyVarSuggestion(el.value, query, name)
      onChange?.(next.value)
      close()
      // The value round-trips through the parent, so the caret is restored once
      // the new text is on screen.
      requestAnimationFrame(() => {
        const input = inputRef.current
        if (!input) return
        input.focus()
        input.setSelectionRange(next.caret, next.caret)
      })
    },
    [close, onChange, query]
  )

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        accept(items[active].name)
        return
      }
      if (e.key === 'Escape') {
        // Only the list closes — not the dialog the input may sit in.
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
    }
    onKeyDown?.(e)
  }

  const resolutions = useMemo(() => {
    if (!scope) return []
    return segs
      .filter((s) => s.isVar)
      .map((s) => ({ name: s.text.slice(2, -2).trim(), value: s.resolved, source: s.source }))
  }, [segs, scope])

  const tooltipContent =
    resolutions.length > 0 ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {resolutions.map((r, i) => (
          <div key={i}>
            <span className="mono">{`{{${r.name}}}`}</span>{' '}
            {r.value === null ? (
              <span style={{ color: 'var(--s-4xx)' }}>{tr('не определена')}</span>
            ) : (
              <>
                = <span className="mono">{r.value}</span>{' '}
                <span style={{ color: 'var(--tx-3)' }}>({r.source})</span>
              </>
            )}
          </div>
        ))}
      </div>
    ) : null

  const popup =
    open && box
      ? createPortal(
          <div
            className="var-suggest"
            style={{
              left: box.left,
              width: box.width,
              ...(box.above ? { bottom: window.innerHeight - box.top } : { top: box.top })
            }}
            role="listbox"
            onMouseDown={(e) => e.preventDefault()}
          >
            {items.map((s, i) => (
              <div
                key={`${s.source}:${s.name}`}
                className={`var-suggest-row${i === active ? ' on' : ''}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => accept(s.name)}
              >
                <span className="var-suggest-name mono">{s.name}</span>
                {s.value !== undefined && (
                  <span className="var-suggest-val mono">{s.secret ? '••••••••' : s.value || tr('пусто')}</span>
                )}
                <span className="var-suggest-src">{tr(SOURCE_LABELS[s.source])}</span>
              </div>
            ))}
            <div className="var-suggest-foot">{tr('↑↓ — выбрать, Enter или Tab — вставить, Esc — скрыть')}</div>
          </div>,
          document.body
        )
      : null

  const inner = (
    <div className={`hl-input ${mono ? 'mono' : ''} ${className}`}>
      <div className="hl-mirror" aria-hidden>
        <span style={{ transform: `translateX(${-scroll}px)`, display: 'inline-block' }}>
          {value === '' ? (
            <span className="ph">{placeholder}</span>
          ) : (
            segs.map((s, i) =>
              s.isVar ? (
                <span key={i} className={`tok ${s.resolved === null ? 'unresolved' : ''}`}>
                  {s.text}
                </span>
              ) : (
                <span key={i}>{s.text}</span>
              )
            )
          )}
        </span>
      </div>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        spellCheck={spellCheck}
        aria-label={ariaLabel}
        aria-expanded={open || undefined}
        autoComplete="off"
        onChange={(e) => {
          onChange?.(e.target.value)
          refresh(e.target.value, e.target.selectionStart)
        }}
        onKeyUp={(e) => {
          // Caret moves that do not change the text. Left/right/Home/End move it
          // even while the list is open (the filter shrinks with it); up/down
          // are the list's own navigation once it is.
          if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key) || (!open && /^Arrow(Up|Down)$/.test(e.key))) {
            refresh(e.currentTarget.value, e.currentTarget.selectionStart)
          }
        }}
        onClick={(e) => refresh(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={close}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        onScroll={(e) => {
          setScroll((e.target as HTMLInputElement).scrollLeft)
          measureClip()
        }}
      />
      {clipped.start && (
        <button
          type="button"
          className="hl-edge start"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => jump('start')}
          title={tr('В начало адреса')}
          aria-label={tr('В начало адреса')}
        >
          <Icon name="toStart" size={13} />
        </button>
      )}
      {clipped.end && (
        <button
          type="button"
          className="hl-edge end"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => jump('end')}
          title={tr('В конец адреса')}
          aria-label={tr('В конец адреса')}
        >
          <Icon name="toEnd" size={13} />
        </button>
      )}
      {popup}
    </div>
  )

  // The hover tooltip would sit on top of the list it is explaining.
  return tooltipContent && !open ? <Tooltip content={tooltipContent}>{inner}</Tooltip> : inner
}
