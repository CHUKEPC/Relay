import { useLayoutEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { Icon } from '@renderer/components/Icon'
import { statusColor } from '@renderer/lib/status-color'
import { useConsole, type ConsoleEntry } from '@renderer/store/console'
import { CONSOLE_HEIGHT, CONSOLE_WIDTH, useUi } from '@renderer/store/ui'
import { trackWallResize } from '@renderer/lib/drag'
import { formatBytes } from '@renderer/lib/format'
import {
  ALL_EDGES,
  DockButtons,
  floatStyle,
  PANEL_DOCK_MODES,
  startFloatResize,
  useDockDrag,
  type DockEdge
} from '@renderer/lib/dock'
import { tr, trf } from '@renderer/lib/i18n'
import '@renderer/styles/feat-resize.css'
import '@renderer/styles/feat-console.css'

/* ============================================================
 * Helpers
 * ============================================================ */

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
          {trf('Показаны первые {shown} символов из {total}.', { shown: BODY_LIMIT.toLocaleString(), total: body.length.toLocaleString() })}
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
      <HeaderList title={tr('Заголовки запроса')} rows={e.requestHeaders} />
      <HeaderList title={tr('Заголовки ответа')} rows={e.responseHeaders} />
      <BodyBlock title={tr('Тело запроса')} body={e.requestBody} />
      <BodyBlock title={tr('Тело ответа')} body={e.responseBody} />
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
 * ConsolePanel — the request log, a panel above the app body
 *
 * It moves like the sidebar, the request and the response: drag the header to
 * an edge of the app body (the landing zones light up), use the position
 * buttons, resize by the inner edge, or float it and move it like a window.
 * Unlike them it stays a layer over the body instead of taking room from it.
 * ============================================================ */

/** The app body's box, kept current — the docked console covers one of its edges. */
function useBodyRect(active: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    if (!active) return
    const body = document.querySelector<HTMLElement>('.body')
    if (!body) return
    const update = (): void => setRect(body.getBoundingClientRect())
    update()
    const ro = new ResizeObserver(update)
    ro.observe(body)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [active])
  return rect
}

/** Inline position of a docked console: one edge of the body, never larger than it. */
function dockedStyle(dock: DockEdge, body: DOMRect, width: number, height: number): CSSProperties {
  const w = Math.min(width, Math.max(CONSOLE_WIDTH.min, body.width - 40))
  const h = Math.min(height, Math.max(CONSOLE_HEIGHT.min, body.height - 40))
  if (dock === 'left') return { left: body.left, top: body.top, width: w, height: body.height }
  if (dock === 'right') return { left: body.right - w, top: body.top, width: w, height: body.height }
  if (dock === 'top') return { left: body.left, top: body.top, width: body.width, height: h }
  return { left: body.left, top: body.bottom - h, width: body.width, height: h }
}

/** The side of the panel its resize handle sits on — the one facing the body. */
const HANDLE_SIDE: Record<DockEdge, DockEdge> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }

export function ConsolePanel(): JSX.Element | null {
  const open = useConsole((s) => s.open)
  const entries = useConsole((s) => s.entries)
  const dock = useUi((s) => s.consoleDock)
  const width = useUi((s) => s.consoleWidth)
  const height = useUi((s) => s.consoleHeight)
  const float = useUi((s) => s.consoleFloat)
  const setConsoleDock = useUi((s) => s.setConsoleDock)
  const setConsoleFloat = useUi((s) => s.setConsoleFloat)
  const body = useBodyRect(open)

  const { onGrabDown, overlay } = useDockDrag({
    container: () => document.querySelector('.body'),
    dock,
    onDock: setConsoleDock,
    edges: ALL_EDGES,
    float,
    setFloat: setConsoleFloat
  })

  if (!open) return null

  const across = dock === 'top' || dock === 'bottom'

  /** Docked: drag the edge facing the body to resize. */
  const onHandleDown = (e: ReactMouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    if (dock === 'float' || !body) return
    const { setConsoleWidth, setConsoleHeight } = useUi.getState()
    trackWallResize(
      e.currentTarget,
      (ev) => {
        if (dock === 'left') setConsoleWidth(ev.clientX - body.left)
        else if (dock === 'right') setConsoleWidth(body.right - ev.clientX)
        else if (dock === 'top') setConsoleHeight(ev.clientY - body.top)
        else setConsoleHeight(body.bottom - ev.clientY)
      },
      across
    )
  }

  const resetSize = (): void => {
    const ui = useUi.getState()
    if (across) ui.setConsoleHeight(CONSOLE_HEIGHT.initial)
    else ui.setConsoleWidth(CONSOLE_WIDTH.initial)
  }

  const style: CSSProperties =
    dock === 'float' ? floatStyle(float, 'viewport') : body ? dockedStyle(dock, body, width, height) : {}

  return (
    <>
      <div className={`console-drawer dock-${dock}`} style={style} role="region" aria-label={tr('Консоль')}>
        <div className="panel-dock-head dock-grip console-head" onMouseDown={onGrabDown} title={tr('Перетащите, чтобы перенести панель')}>
          <Icon name="grip" size={13} className="console-head-grip" />
          <span className="panel-dock-title">{tr('Консоль')}</span>
          <span className="console-head-count">{entries.length}</span>
          <DockButtons dock={dock} onDock={setConsoleDock} modes={PANEL_DOCK_MODES} />
          <button
            type="button"
            className="icon-btn console-head-act"
            onClick={() => useConsole.getState().clear()}
            disabled={entries.length === 0}
            title={tr('Очистить')}
            aria-label={tr('Очистить')}
          >
            <Icon name="trash" size={13} />
          </button>
          <button
            type="button"
            className="icon-btn console-head-act"
            onClick={() => useConsole.getState().setOpen(false)}
            title={tr('Закрыть консоль')}
            aria-label={tr('Закрыть консоль')}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="console-empty">
            <div className="console-empty-ico">
              <Icon name="code2" size={22} />
            </div>
            <div className="console-empty-title">{tr('Логи пусты')}</div>
            <div className="console-empty-sub">{tr('Отправьте запрос — детали появятся здесь.')}</div>
          </div>
        ) : (
          <div className="console-list">
            {/* newest first */}
            {[...entries].reverse().map((e) => (
              <EntryRow key={e.id} e={e} />
            ))}
          </div>
        )}

        {dock === 'float' ? (
          <div className="float-grip" onMouseDown={(e) => startFloatResize(e, float, setConsoleFloat)} />
        ) : (
          <div
            className={`wall-handle ${HANDLE_SIDE[dock]}`}
            aria-hidden="true"
            onMouseDown={onHandleDown}
            onDoubleClick={resetSize}
            title={tr('Перетащите, чтобы изменить размер · двойной клик — сброс')}
          />
        )}
      </div>
      {overlay}
    </>
  )
}
