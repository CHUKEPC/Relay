import { useEffect, useRef, useState } from 'react'
import type { RealtimeMessage } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useGrpc, type GrpcStatus } from '@renderer/store/grpc'

/** Bottom/right-panel view for a gRPC call (replaces the HTTP response). */

const STATUS_LABEL: Record<GrpcStatus, string> = {
  idle: 'Готов',
  running: 'Выполняется…',
  done: 'Завершено',
  error: 'Ошибка'
}

function statusColor(status: GrpcStatus): string {
  if (status === 'running') return 'var(--s-3xx)'
  if (status === 'done') return 'var(--s-2xx)'
  if (status === 'error') return 'var(--s-5xx)'
  return 'var(--tx-3)'
}

function fmtTime(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function MessageRow({ m }: { m: RealtimeMessage }): JSX.Element {
  const dirIcon = m.dir === 'out' ? 'arrowR' : m.dir === 'in' ? 'download' : 'info'
  const dirColor = m.dir === 'out' ? 'var(--accent)' : m.dir === 'in' ? 'var(--s-2xx)' : 'var(--tx-3)'
  return (
    <div className="rt-msg">
      <Icon name={dirIcon} size={13} style={{ color: dirColor, flex: 'none', marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <pre className="rt-msg-data">{m.data}</pre>
      </div>
      <span className="rt-msg-meta">
        {m.kind && m.kind !== 'text' && m.kind !== 'system' && m.kind !== 'message' ? `${m.kind} · ` : ''}
        {fmtTime(m.at)}
      </span>
    </div>
  )
}

export function GrpcResponse({ tabId }: { tabId: string }): JSX.Element {
  const g = useGrpc((s) => s.byTab[tabId]) ?? { status: 'idle' as GrpcStatus, messages: [] }
  const send = useGrpc((s) => s.send)
  const end = useGrpc((s) => s.end)
  const clear = useGrpc((s) => s.clear)
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [g.messages.length])

  const sc = statusColor(g.status)
  // Streaming composer is only meaningful for client-/bidi-streaming calls.
  const canStream = (g.callKind === 'client_stream' || g.callKind === 'bidi') && g.status === 'running'
  const inCount = g.messages.filter((m) => m.dir === 'in').length

  const doSend = (): void => {
    if (!draft.trim()) return
    send(tabId, draft)
    setDraft('')
  }

  return (
    <div className="response" style={{ flex: 1 }}>
      <div className="resp-statusbar">
        <span className="status-pill" style={{ color: sc, background: `color-mix(in oklch, ${sc} 14%, transparent)` }}>
          <span className="pulse" style={{ background: sc }} />
          {STATUS_LABEL[g.status]}
        </span>
        <div className="resp-meta">
          <span>gRPC</span>
          <span className="sep">•</span>
          <span>{inCount} ответ(ов)</span>
        </div>
        <div className="resp-actions">
          <button className="btn ghost" style={{ height: 28 }} onClick={() => clear(tabId)} title="Очистить лог">
            <Icon name="trash" size={13} />
            Очистить
          </button>
        </div>
      </div>

      <div className="rt-log" ref={logRef}>
        {g.messages.length === 0 ? (
          <div className="empty" style={{ padding: 30 }}>
            <div className="empty-card">
              <div className="empty-ico">
                <Icon name="bolt" size={22} />
              </div>
              <p style={{ marginBottom: 0 }}>Загрузите .proto, выберите метод и нажмите «Вызвать».</p>
            </div>
          </div>
        ) : (
          g.messages.map((m) => <MessageRow key={m.id} m={m} />)
        )}
      </div>

      {canStream && (
        <div className="rt-composer">
          <textarea
            value={draft}
            placeholder="Сообщение потока (JSON)… (Ctrl/⌘+Enter — отправить)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                doSend()
              }
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'flex-end' }}>
            <button className="btn primary" onClick={doSend}>
              Отправить
              <Icon name="send" size={14} />
            </button>
            <button className="btn" onClick={() => end(tabId)} title="Завершить отправку (half-close)">
              Завершить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
