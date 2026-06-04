import { useEffect, useRef, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { Popover } from '@renderer/components/primitives'
import { useAi } from '@renderer/store/ai'
import { useSettings } from '@renderer/store/settings'
import { useEnvironments } from '@renderer/store/environments'
import { useResponse } from '@renderer/store/response'
import { useActiveRequest, useActiveTab } from '@renderer/lib/hooks'
import { currentScope, currentSecretValues } from '@renderer/lib/request-runner'
import { buildContextSnapshot } from '@renderer/lib/ai-context'
import { interpolate } from '@shared/interpolate'
import { MessageContent } from './MessageContent'

const SUGGESTIONS = [
  { icon: 'info', text: 'Объясни этот ответ', prompt: 'Объясни текущий ответ: что он означает, структуру полей и есть ли проблемы.' },
  { icon: 'warn', text: 'Диагностировать ошибку', prompt: 'Разбери ошибку текущего ответа/запроса и предложи конкретное исправление.' },
  { icon: 'code2', text: 'Сгенерировать curl', prompt: 'Сгенерируй curl-команду для текущего запроса в блоке ```bash.' },
  { icon: 'check', text: 'Написать тесты', prompt: 'Напиши pm.test тесты для текущего ответа в блоке ```javascript.' },
  { icon: 'doc', text: 'Документация', prompt: 'Сделай краткую Markdown-документацию для этого эндпоинта.' }
]

function shortPath(url: string): string {
  const noVars = url.replace(/\{\{[^}]+\}\}/g, '')
  const m = noVars.match(/^https?:\/\/[^/]+(\/.*)?$/)
  return m && m[1] ? m[1].split('?')[0] : url
}

export function AiPanel({ onClose, onConnect }: { onClose: () => void; onConnect: () => void }) {
  const isConnected = useAi((s) => s.activeProvider()?.hasKey || false)
  return isConnected ? <AiPanelConnected onClose={onClose} /> : <AiPanelEmpty onClose={onClose} onConnect={onConnect} />
}

function AiPanelConnected({ onClose }: { onClose: () => void }) {
  const thread = useAi((s) => s.thread)
  const isStreaming = useAi((s) => s.isStreaming)
  const send = useAi((s) => s.send)
  const cancel = useAi((s) => s.cancel)
  const provider = useAi((s) => s.activeProvider())
  const [input, setInput] = useState('')
  const [ctxOn, setCtxOn] = useState(true)
  const threadRef = useRef<HTMLDivElement>(null)

  const req = useActiveRequest()
  const tab = useActiveTab()
  const lastResult = useResponse((s) => (tab ? s.byTab[tab.id]?.result : undefined))
  const sendAiContext = useSettings((s) => s.settings.sendAiContext)
  const activeEnv = useEnvironments((s) => s.env.environments.find((e) => e.id === s.env.activeEnvironmentId) ?? null)

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight
  }, [thread, isStreaming])

  const submit = (text: string) => {
    if (!text.trim()) return
    const useCtx = ctxOn && sendAiContext && !!req
    let snapshot
    let label: { label: string; icon: string } | undefined
    if (useCtx && req) {
      const scope = currentScope()
      snapshot = buildContextSnapshot({
        request: req,
        resolvedUrl: interpolate(req.url, scope),
        response: lastResult,
        envName: activeEnv?.name,
        envVarNames: activeEnv?.variables.filter((v) => v.enabled).map((v) => v.key),
        secretValues: currentSecretValues()
      })
      label = { label: `${req.method} ${shortPath(req.url)}${lastResult ? ` · ${lastResult.status}` : ''}`, icon: 'doc' }
    }
    void send(text.trim(), snapshot, label)
    setInput('')
  }

  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <div className="ai-title">
          <span className="ai-spark">
            <Icon name="sparkle" size={14} />
          </span>
          AI-ассистент
        </div>
        <ModelPill />
        {thread.length > 0 && (
          <button className="icon-btn" title="Новый диалог" onClick={() => useAi.getState().clearThread()}>
            <Icon name="plus" size={15} />
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title="Скрыть панель (⌘J)">
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="ai-thread" ref={threadRef}>
        {thread.length === 0 && (
          <div className="msg ai">
            <div className="who">
              <span className="glyph" style={{ background: 'var(--accent)', width: 14, height: 14, borderRadius: 4, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>
                ✦
              </span>
              Relay AI
            </div>
            <div className="bubble">
              <p>
                Привет! Я подключён к текущему запросу и ответу. Могу <strong>объяснить ответ</strong>, <strong>сгенерировать запрос</strong> из описания, разобрать ошибку, написать тесты или собрать <code>curl</code>.
              </p>
            </div>
            <div className="ai-suggest">
              {SUGGESTIONS.map((s, i) => (
                <button key={i} className="sug-chip" onClick={() => submit(s.prompt)}>
                  <Icon name={s.icon} size={13} />
                  {s.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {thread.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg user">
              {m.context && (
                <div className="ctx-card">
                  <span className="ci">
                    <Icon name={m.context.icon} size={13} />
                  </span>
                  <span className="ct mono">{m.context.label}</span>
                </div>
              )}
              <div className="bubble">{m.content}</div>
            </div>
          ) : (
            <div key={m.id} className="msg ai">
              <div className="who">
                <span className="glyph" style={{ background: 'var(--accent)', width: 14, height: 14, borderRadius: 4, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 9, fontWeight: 700 }}>
                  ✦
                </span>
                Relay AI
              </div>
              <div className="bubble">
                {m.content ? (
                  <MessageContent content={m.content} />
                ) : m.streaming ? (
                  <div className="typing">
                    <i />
                    <i />
                    <i />
                  </div>
                ) : null}
              </div>
            </div>
          )
        )}
      </div>

      <div className="ai-composer">
        <div className="composer-box">
          <textarea
            placeholder="Спросите про запрос, ошибку или API…"
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit(input)
              }
            }}
          />
          <div className="composer-foot">
            <button className={`ctxbtn ${ctxOn ? 'on' : ''}`} onClick={() => setCtxOn((o) => !o)} title="Прикреплять контекст запроса/ответа">
              <Icon name="link" size={13} />
              Контекст запроса
            </button>
            <div className="grow" />
            {isStreaming ? (
              <button className="send-msg" onClick={() => cancel()} title="Остановить">
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button className="send-msg" disabled={!input.trim()} onClick={() => submit(input)}>
                <Icon name="send" size={14} />
              </button>
            )}
          </div>
        </div>
        {provider && (
          <div style={{ fontSize: 10.5, color: 'var(--tx-3)', textAlign: 'center', marginTop: 6 }}>
            {provider.label} · {provider.defaultModel}
          </div>
        )}
      </div>
    </aside>
  )
}

function ModelPill() {
  const provider = useAi((s) => s.activeProvider())
  const providers = useAi((s) => s.providers.providers)
  const setActiveProvider = useAi((s) => s.setActiveProvider)
  const setProviderModel = useAi((s) => s.setProviderModel)
  const [open, setOpen] = useState(false)
  if (!provider) return null

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      trigger={
        <button className="ai-model-pill">
          <span className="glyph" style={{ background: `oklch(0.62 0.17 ${provider.hue})` }}>
            {provider.glyph}
          </span>
          {provider.defaultModel}
          <Icon name="chevDsm" size={12} style={{ color: 'var(--tx-3)' }} />
        </button>
      }
    >
      <div style={{ minWidth: 240 }}>
        {providers
          .filter((p) => p.hasKey)
          .map((p) => (
            <div key={p.id}>
              {p.models.map((mo) => (
                <div
                  key={mo}
                  className={`pop-item ${p.id === provider.id && mo === provider.defaultModel ? 'on' : ''}`}
                  onClick={() => {
                    setActiveProvider(p.id)
                    setProviderModel(p.id, mo)
                    setOpen(false)
                  }}
                >
                  <span
                    className="glyph"
                    style={{ width: 16, height: 16, borderRadius: 4, display: 'grid', placeItems: 'center', background: `oklch(0.6 0.17 ${p.hue})`, color: '#fff', fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                  >
                    {p.glyph}
                  </span>
                  <span className="mono" style={{ fontSize: 11.5, flex: 1 }}>
                    {mo}
                  </span>
                  {p.id === provider.id && mo === provider.defaultModel && <Icon name="check" size={14} className="tick" />}
                </div>
              ))}
            </div>
          ))}
        {providers.filter((p) => p.hasKey).length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--tx-3)' }}>Нет подключённых провайдеров</div>
        )}
      </div>
    </Popover>
  )
}

function AiPanelEmpty({ onClose, onConnect }: { onClose: () => void; onConnect: () => void }) {
  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <div className="ai-title">
          <span className="ai-spark">
            <Icon name="sparkle" size={14} />
          </span>
          AI-ассистент
        </div>
        <button className="icon-btn" onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="empty" style={{ flex: 1 }}>
        <div className="empty-card">
          <div className="empty-ico" style={{ color: 'var(--accent)', background: 'var(--accent-soft)', borderColor: 'transparent' }}>
            <Icon name="sparkle" size={24} />
          </div>
          <h3>Подключите AI-провайдера</h3>
          <p>Выберите OpenAI, Anthropic, OpenRouter или локальную модель и добавьте ключ — ассистент заработает прямо здесь.</p>
          <div className="empty-actions">
            <button className="btn primary" onClick={onConnect}>
              <Icon name="bolt" size={14} />
              Подключить провайдера
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
