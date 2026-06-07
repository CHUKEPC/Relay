import { useEffect, useRef, useState } from 'react'
import type { MessageTemplate, RealtimeMessage } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'
import { useRealtime, type RealtimeStatus, type RtKind } from '@renderer/store/realtime'
import { makeId } from '@shared/id'
import { templatesForKind } from './templates'

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

  // Subscribe to this tab's request so saved templates + MQTT config stay in sync.
  const req = useTabs((s) => s.doc.tabs.find((t) => t.id === tabId)?.request)
  const patchActive = useTabs((s) => s.patchActive)

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

  const templates = templatesForKind(req?.messageTemplates, kind)
  const mqttCfg = req?.mqtt
  const mqttQos: 0 | 1 | 2 = mqttCfg?.qos === 1 || mqttCfg?.qos === 2 ? mqttCfg.qos : 0
  const lwt = mqttCfg?.lwt

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

  // Load a saved template into the composer (and the event/topic field per mode).
  const loadTemplate = (t: MessageTemplate): void => {
    setDraft(t.content)
    if (kind === 'socketio' && t.event) setEvent(t.event)
    if (kind === 'mqtt' && t.topic) setTopic(t.topic)
  }

  // Save the current composer contents as a named template via the tabs store.
  const saveTemplate = (): void => {
    const content = draft
    if (!content.trim()) {
      useUi.getState().showToast('Нечего сохранять — composer пуст', 'error')
      return
    }
    const name = window.prompt('Название шаблона:')?.trim()
    if (!name) return
    const tpl: MessageTemplate = {
      id: makeId('mt'),
      name,
      content,
      ...(kind === 'socketio' && event.trim() ? { event: event.trim() } : {}),
      ...(kind === 'mqtt' && topic.trim() ? { topic: topic.trim() } : {})
    }
    const existing = req?.messageTemplates ?? []
    patchActive({ messageTemplates: [...existing, tpl] })
    useUi.getState().showToast('Шаблон сохранён')
  }

  const deleteTemplate = (id: string): void => {
    const existing = req?.messageTemplates ?? []
    patchActive({ messageTemplates: existing.filter((t) => t.id !== id) })
  }

  // Patch the MQTT QoS/LWT config without clobbering the other field.
  const patchMqtt = (next: Partial<NonNullable<typeof mqttCfg>>): void => {
    patchActive({ mqtt: { ...(req?.mqtt ?? {}), ...next } })
  }
  const patchLwt = (next: Partial<NonNullable<typeof lwt>>): void => {
    const base = lwt ?? { topic: '', payload: '' }
    patchMqtt({ lwt: { ...base, ...next } })
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

      {/* MQTT: per-request QoS + Last-Will config, persisted onto the request. */}
      {kind === 'mqtt' && (
        <div className="rt-mqtt-config" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tx-2)' }}>
            QoS
            <select
              className="input"
              value={mqttQos}
              onChange={(e) => patchMqtt({ qos: Number(e.target.value) as 0 | 1 | 2 })}
              style={{ width: 60, height: 28 }}
            >
              <option value={0}>0</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
          <span style={{ width: 1, height: 18, background: 'var(--line)' }} />
          <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>Last Will</span>
          <input
            className="input mono"
            placeholder="will topic"
            value={lwt?.topic ?? ''}
            onChange={(e) => patchLwt({ topic: e.target.value })}
            style={{ width: 150, height: 28 }}
          />
          <input
            className="input mono"
            placeholder="will payload"
            value={lwt?.payload ?? ''}
            onChange={(e) => patchLwt({ payload: e.target.value })}
            style={{ width: 160, height: 28 }}
          />
          <select
            className="input"
            value={lwt?.qos === 1 || lwt?.qos === 2 ? lwt.qos : 0}
            onChange={(e) => patchLwt({ qos: Number(e.target.value) as 0 | 1 | 2 })}
            title="Will QoS"
            style={{ width: 60, height: 28 }}
          >
            <option value={0}>QoS 0</option>
            <option value={1}>QoS 1</option>
            <option value={2}>QoS 2</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--tx-2)' }}>
            <input type="checkbox" checked={lwt?.retain === true} onChange={(e) => patchLwt({ retain: e.target.checked })} />
            retain
          </label>
        </div>
      )}

      {/* Saved message templates (not applicable to SSE — it has no outbound channel). */}
      {kind !== 'sse' && (
        <div className="rt-templates" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
          <span style={{ fontSize: 11, color: 'var(--tx-3)', flex: 'none', textTransform: 'uppercase', letterSpacing: '.04em' }}>Шаблоны</span>
          {templates.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>—</span>
          ) : (
            templates.map((t) => (
              <span key={t.id} className="rt-template-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 4px 2px 8px' }}>
                <button
                  className="btn ghost"
                  style={{ height: 22, padding: '0 4px', fontSize: 12 }}
                  onClick={() => loadTemplate(t)}
                  title={t.content}
                >
                  {t.name}
                </button>
                <button
                  className="btn ghost"
                  style={{ height: 20, width: 20, padding: 0, justifyContent: 'center' }}
                  onClick={() => deleteTemplate(t.id)}
                  title="Удалить шаблон"
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))
          )}
          <button
            className="btn ghost"
            style={{ height: 24, marginLeft: 'auto', flex: 'none' }}
            onClick={saveTemplate}
            title="Сохранить текущее сообщение как шаблон"
          >
            <Icon name="plus" size={12} />
            Сохранить как шаблон
          </button>
        </div>
      )}

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
