import { useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { statusColor } from '@renderer/lib/status-color'
import { useConsole, type ConsoleEntry } from '@renderer/store/console'

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
 * ConsolePanel — bottom drawer (request log)
 * ============================================================ */

export function ConsolePanel(): JSX.Element | null {
  const open = useConsole((s) => s.open)
  const entries = useConsole((s) => s.entries)
  const clear = useConsole((s) => s.clear)
  const setOpen = useConsole((s) => s.setOpen)

  if (!open) return null

  // Newest first.
  const ordered = [...entries].reverse()

  return (
    <div className="console-drawer" role="region" aria-label="Консоль">
      <div className="console-head">
        <Icon name="code2" size={15} className="console-head-ico" />
        <span className="console-head-title">Консоль</span>
        <span className="console-head-count">{entries.length}</span>
        <div className="console-head-spacer" />
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
    </div>
  )
}
