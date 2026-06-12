import { useEffect, useRef, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { statusColor } from '@renderer/lib/status-color'
import { useConsole, type ConsoleEntry } from '@renderer/store/console'
import { useUi, type ConsoleDock } from '@renderer/store/ui'
import { trackDrag } from '@renderer/lib/drag'
import { clamp } from '@renderer/lib/math'
import '@renderer/styles/feat-console.css'

/* ============================================================
 * Helpers
 * ============================================================ */

/** Format a byte count into B / KB / MB (local copy to keep this self-contained). */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 2 : 1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/** Format a duration in ms; promotes to seconds past 1000ms. */
function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

/** Clock time (HH:MM:SS) for an entry timestamp. */
function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const BODY_LIMIT = 5000

/** Trim very long bodies and append a localized truncation note. */
function clampBody(text: string): { text: string; truncated: boolean } {
  if (text.length <= BODY_LIMIT) return { text, truncated: false }
  return { text: text.slice(0, BODY_LIMIT), truncated: true }
}

/** Short status label for the pill: real code, or ERR for a transport error. */
function statusLabel(e: ConsoleEntry): string {
  if (e.status > 0) return String(e.status)
  return 'ERR'
}

/* ============================================================
 * Header line for one entry (the clickable toggle row)
 * ============================================================ */

function EntryHead({ e, expanded, onToggle }: { e: ConsoleEntry; expanded: boolean; onToggle: () => void }): JSX.Element {
  const sc = statusColor(e.status)
  return (
    <button
      type="button"
      className="console-row-head"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <Icon name={expanded ? 'chevD' : 'chevR'} size={14} className="console-chev" />
      <span className="console-status" style={{ color: sc, background: `color-mix(in oklch, ${sc} 14%, transparent)` }}>
        {statusLabel(e)}
      </span>
      <span className={`method-tag m-${e.method} console-method`}>{e.method}</span>
      <span className="console-url" title={e.url}>
        {e.url}
      </span>
      <span className="console-meta">
        <span>{formatMs(e.timeMs)}</span>
        <span className="console-sep">•</span>
        <span>{formatBytes(e.sizeBytes)}</span>
        <span className="console-sep">•</span>
        <span className="console-time">{formatTime(e.at)}</span>
      </span>
    </button>
  )
}

/* ============================================================
 * A small key:value list (request / response headers)
 * ============================================================ */

function HeaderList({ title, rows }: { title: string; rows: [string, string][] }): JSX.Element {
  return (
    <div className="console-section">
      <div className="console-section-title">
        {title}
        <span className="console-section-count">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="console-section-empty">—</div>
      ) : (
        <div className="console-kv">
          {rows.map(([k, v], i) => (
            <div className="console-kv-row" key={i}>
              <span className="console-kv-key">{k}</span>
              <span className="console-kv-val">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ============================================================
 * A body block (request / response body) rendered in <pre>
 * ============================================================ */

function BodyBlock({ title, body }: { title: string; body: string | undefined }): JSX.Element | null {
  if (body == null || body === '') return null
  const { text, truncated } = clampBody(body)
  return (
    <div className="console-section">
      <div className="console-section-title">{title}</div>
      <pre className="console-body">{text}</pre>
      {truncated && (
        <div className="console-section-note">
          Показаны первые {BODY_LIMIT.toLocaleString('ru-RU')} символов из {body.length.toLocaleString('ru-RU')}.
        </div>
      )}
    </div>
  )
}

/* ============================================================
 * Expanded details for one entry
 * ============================================================ */

function EntryDetails({ e }: { e: ConsoleEntry }): JSX.Element {
  return (
    <div className="console-details">
      {e.error && (
        <div className="console-error">
          <Icon name="warn" size={14} />
          {e.error}
        </div>
      )}
      <HeaderList title="Заголовки запроса" rows={e.requestHeaders} />
      <HeaderList title="Заголовки ответа" rows={e.responseHeaders} />
      <BodyBlock title="Тело запроса" body={e.requestBody} />
      <BodyBlock title="Тело ответа" body={e.responseBody} />
    </div>
  )
}

/* ============================================================
 * One collapsible entry row
 * ============================================================ */

function EntryRow({ e }: { e: ConsoleEntry }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`console-row${expanded ? ' open' : ''}`}>
      <EntryHead e={e} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
      {expanded && <EntryDetails e={e} />}
    </div>
  )
}

/* ============================================================
 * ConsolePanel — dockable drawer (request log)
 * Dock modes: bottom (default) / left / right / float.
 * ============================================================ */

const DOCK_OPTIONS: { mode: ConsoleDock; icon: string; title: string }[] = [
  { mode: 'bottom', icon: 'dockBottom', title: 'Закрепить снизу' },
  { mode: 'left', icon: 'dockLeft', title: 'Закрепить слева' },
  { mode: 'right', icon: 'dockRight', title: 'Закрепить справа' },
  { mode: 'float', icon: 'floatWin', title: 'Плавающее окно' }
]

/** Header height (px) — keep at least this much of the float window on screen. */
const FLOAT_HEAD_H = 38
const FLOAT_MIN_W = 380
const FLOAT_MIN_H = 240

export function ConsolePanel(): JSX.Element | null {
  const open = useConsole((s) => s.open)
  const entries = useConsole((s) => s.entries)
  const clear = useConsole((s) => s.clear)
  const setOpen = useConsole((s) => s.setOpen)
  const dock = useUi((s) => s.consoleDock)
  const size = useUi((s) => s.consoleSize)
  const floatRect = useUi((s) => s.consoleFloat)
  const setConsoleDock = useUi((s) => s.setConsoleDock)
  const setConsoleSize = useUi((s) => s.setConsoleSize)
  const setConsoleFloat = useUi((s) => s.setConsoleFloat)

  // Active-drag cleanup so window listeners never leak past unmount.
  const dragCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => dragCleanupRef.current?.(), [])

  /** Wire a window-level drag session (shared helper keeps cursor/selection state). */
  const startDrag = (move: (ev: MouseEvent) => void, cursor: string): void => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = trackDrag(move, { cursor, onEnd: () => (dragCleanupRef.current = null) })
  }

  /** Docked modes: drag the inner edge to resize (store clamps 160..800). */
  const onResizeDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    const mode = dock
    startDrag((ev) => {
      if (mode === 'bottom') setConsoleSize(window.innerHeight - ev.clientY)
      else if (mode === 'left') setConsoleSize(ev.clientX)
      else setConsoleSize(window.innerWidth - ev.clientX)
    }, mode === 'bottom' ? 'row-resize' : 'col-resize')
  }

  /** Float mode: header background drags the window (buttons excluded). */
  const onHeadDown = (e: React.MouseEvent): void => {
    if (dock !== 'float') return
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY }
    const orig = useUi.getState().consoleFloat
    startDrag((ev) => {
      // Keep at least 120px of the header horizontally and the full header vertically on screen.
      const x = clamp(orig.x + ev.clientX - start.x, 120 - orig.w, window.innerWidth - 120)
      const y = clamp(orig.y + ev.clientY - start.y, 0, window.innerHeight - FLOAT_HEAD_H)
      setConsoleFloat({ ...orig, x, y })
    }, 'grabbing')
  }

  /** Float mode: bottom-right grip resizes width/height. */
  const onGripDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY }
    const orig = useUi.getState().consoleFloat
    startDrag((ev) => {
      const w = Math.max(FLOAT_MIN_W, orig.w + ev.clientX - start.x)
      const h = Math.max(FLOAT_MIN_H, orig.h + ev.clientY - start.y)
      setConsoleFloat({ ...orig, w, h })
    }, 'nwse-resize')
  }

  if (!open) return null

  // Newest first.
  const ordered = [...entries].reverse()

  const rootStyle: React.CSSProperties =
    dock === 'bottom'
      ? { height: size }
      : dock === 'float'
        ? { left: floatRect.x, top: floatRect.y, width: floatRect.w, height: floatRect.h }
        : { width: size }

  return (
    <div className={`console-drawer dock-${dock}`} style={rootStyle} role="region" aria-label="Консоль">
      {dock !== 'float' && <div className="console-resize" onMouseDown={onResizeDown} />}
      <div className="console-head" onMouseDown={onHeadDown}>
        <Icon name="code2" size={15} className="console-head-ico" />
        <span className="console-head-title">Консоль</span>
        <span className="console-head-count">{entries.length}</span>
        <div className="console-head-spacer" />
        <div className="console-dock-group">
          {DOCK_OPTIONS.map((o) => (
            <button
              key={o.mode}
              type="button"
              className={`icon-btn console-dock-btn${dock === o.mode ? ' on' : ''}`}
              onClick={() => setConsoleDock(o.mode)}
              title={o.title}
              aria-label={o.title}
            >
              <Icon name={o.icon} size={14} />
            </button>
          ))}
        </div>
        <button type="button" className="btn ghost console-head-btn" onClick={clear} disabled={entries.length === 0}>
          <Icon name="trash" size={14} />
          Очистить
        </button>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} title="Закрыть консоль" aria-label="Закрыть консоль">
          <Icon name="close" size={15} />
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="console-empty">
          <div className="console-empty-ico">
            <Icon name="code2" size={22} />
          </div>
          <div className="console-empty-title">Логи пусты</div>
          <div className="console-empty-sub">Отправьте запрос — детали появятся здесь.</div>
        </div>
      ) : (
        <div className="console-list">
          {ordered.map((e) => (
            <EntryRow key={e.id} e={e} />
          ))}
        </div>
      )}

      {dock === 'float' && <div className="console-float-grip" onMouseDown={onGripDown} />}
    </div>
  )
}
