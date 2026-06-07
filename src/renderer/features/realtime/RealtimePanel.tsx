import { useEffect, useRef, useState } from 'react'
import type { RealtimeMessage } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useRealtime, type RealtimeStatus, type RtKind } from '@renderer/store/realtime'

/** Bottom-panel view for WebSocket / SSE / Socket.IO / MQTT (replaces the HTTP response). */

const KIND_LABEL: Record<RtKind, string> = {
  websocket: 'WebSocket',
  sse: 'Server-Sent Events',
  socketio: 'Socket.IO',
  mqtt: 'MQTT'
}

const STATUS_LABEL: Record<RealtimeStatus, string> = {
  idle: 'Не подключено',
  connecting: 'Подключение…',
  open: 'Подключено',
  closed: 'Закрыто',
  error: 'Ошибка'
}

function statusColor(status: RealtimeStatus): string {
  if (status === 'open') return 'var(--s-2xx)'
  if (status === 'connecting') return 'var(--s-3xx)'
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
  const label = m.kind === 'binary' ? `[binary] ${m.data.slice(0, 120)}` : m.data
  return (
    <div className="rt-msg">
      <Icon name={dirIcon} size={13} style={{ color: dirColor, flex: 'none', marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <pre className="rt-msg-data">{label}</pre>
      </div>
      <span className="rt-msg-meta">
        {m.kind && m.kind !== 'text' && m.kind !== 'system' ? `${m.kind} · ` : ''}
        {fmtTime(m.at)}
      </span>
    </div>
  )
}

export function RealtimePanel({ tabId, kind }: { tabId: string; kind: RtKind }): JSX.Element {
  const rt = useRealtime((s) => s.byTab[tabId]) ?? { status: 'idle' as RealtimeStatus, messages: [] }
  const send = useRealtime((s) => s.send)
  const emit = useRealtime((s) => s.emit)
  const publish = useRealtime((s) => s.publish)
  const subscribe = useRealtime((s) => s.subscribe)
  const clear = useRealtime((s) => s.clear)
  const [draft, setDraft] = useState('')
  const [event, setEvent] = useState('message')
  const [topic, setTopic] = useState('')
  const [subTopic, setSubTopic] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rt.messages.length])

  const sc = statusColor(rt.status)
  const open = rt.status === 'open'

  const doSend = (): void => {
    if (kind === 'websocket') {
      send(tabId, draft)
      setDraft('')
    } else if (kind === 'socketio') {
      if (!event.trim()) return
      emit(tabId, event.trim(), draft)
      setDraft('')
    } else if (kind === 'mqtt') {
      if (!topic.trim()) return
      publish(tabId, topic.trim(), draft)
      setDraft('')
    }
  }

  return (
    <div className="response" style={{ flex: 1 }}>
      <div className="resp-statusbar">
        <span className="status-pill" style={{ color: sc, background: `color-mix(in oklch, ${sc} 14%, transparent)` }}>
          <span className="pulse" style={{ background: sc }} />
          {STATUS_LABEL[rt.status]}
        </span>
        <div className="resp-meta">
          <span>{KIND_LABEL[kind]}</span>
          <span className="sep">•</span>
          <span>{rt.messages.filter((m) => m.dir !== 'system').length} сообщений</span>
        </div>
        <div className="resp-actions">
          <button className="btn ghost" style={{ height: 28 }} onClick={() => clear(tabId)} title="Очистить лог">
            <Icon name="trash" size={13} />
            Очистить
          </button>
        </div>
      </div>

      <div className="rt-log" ref={logRef}>
        {rt.messages.length === 0 ? (
          <div className="empty" style={{ padding: 30 }}>
            <div className="empty-card">
              <div className="empty-ico">
                <Icon name="bolt" size={22} />
              </div>
              <p style={{ marginBottom: 0 }}>
                Подключитесь, чтобы {kind === 'sse' ? 'получать события' : 'обмениваться сообщениями'} по {KIND_LABEL[kind]}.
              </p>
            </div>
          </div>
        ) : (
          rt.messages.map((m) => <MessageRow key={m.id} m={m} />)
        )}
      </div>

      {/* MQTT: a subscribe row above the publish composer. */}
      {kind === 'mqtt' && (
        <div className="rt-composer" style={{ borderTop: '1px solid var(--line)', paddingBottom: 0 }}>
          <input
            className="input mono"
            placeholder="Топик для подписки, напр. sensors/#"
            value={subTopic}
            disabled={!open}
            onChange={(e) => setSubTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && subTopic.trim()) {
                subscribe(tabId, subTopic.trim())
                setSubTopic('')
              }
            }}
            style={{ flex: 1 }}
          />
          <button
            className="btn"
            disabled={!open || !subTopic.trim()}
            onClick={() => {
              subscribe(tabId, subTopic.trim())
              setSubTopic('')
            }}
            style={{ alignSelf: 'flex-end' }}
          >
            Подписаться
          </button>
        </div>
      )}

      {kind !== 'sse' && (
        <div className="rt-composer">
          {kind === 'socketio' && (
            <input
              className="input mono"
              placeholder="event"
              value={event}
              disabled={!open}
              onChange={(e) => setEvent(e.target.value)}
              style={{ width: 140, alignSelf: 'flex-end' }}
            />
          )}
          {kind === 'mqtt' && (
            <input
              className="input mono"
              placeholder="топик для публикации"
              value={topic}
              disabled={!open}
              onChange={(e) => setTopic(e.target.value)}
              style={{ width: 200, alignSelf: 'flex-end' }}
            />
          )}
          <textarea
            value={draft}
            placeholder={open ? 'Сообщение… (Ctrl/⌘+Enter — отправить)' : 'Подключитесь, чтобы отправлять'}
            disabled={!open}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                doSend()
              }
            }}
          />
          <button className="btn primary" disabled={!open} onClick={doSend} style={{ alignSelf: 'flex-end' }}>
            {kind === 'socketio' ? 'Emit' : kind === 'mqtt' ? 'Publish' : 'Отправить'}
            <Icon name="send" size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
