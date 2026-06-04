import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import type { VariableScope } from '@shared/types'
import { resolveString } from '@shared/interpolate'
import { Tooltip } from './primitives'

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
      const name = p.slice(2, -2).trim()
      const t = scope ? resolveString(p, scope).tokens[0] : undefined
      segs.push({ text: p, isVar: true, resolved: t?.value ?? null, source: t?.source })
    } else {
      segs.push({ text: p, isVar: false })
    }
  }
  return segs
}

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
}

/** Single-line input that highlights {{variables}} via a mirror layer, flags
 *  unresolved ones, and shows resolution on hover. */
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
  ariaLabel
}: HighlightedInputProps) {
  const [scroll, setScroll] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const segs = useMemo(() => parse(value, scope), [value, scope])

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
              <span style={{ color: 'var(--s-4xx)' }}>не определена</span>
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
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onScroll={(e) => setScroll((e.target as HTMLInputElement).scrollLeft)}
      />
    </div>
  )

  return tooltipContent ? <Tooltip content={tooltipContent}>{inner}</Tooltip> : inner
}
