import { useEffect, useMemo, useRef, useState } from 'react'
import { useResponse, type TabResponse } from '@renderer/store/response'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { CodeEditor } from '@renderer/components/CodeEditor'
import { Icon } from '@renderer/components/Icon'
import { Field, IconButton, Modal, Segmented } from '@renderer/components/primitives'
import { monaco } from '@renderer/lib/monaco'
import { saveResponseExample } from '@renderer/lib/examples'
import { statusColor } from '@renderer/lib/status-color'
import { kbd } from '@renderer/lib/platform'
import { VisualizerTab } from './VisualizerTab'
import { CookieManager } from '@renderer/features/cookies/CookieManager'
import type { ResponseResult, HttpErrorKind } from '@shared/types'

/* ============================================================
 * Helpers
 * ============================================================ */

/** Format a byte count into B / KB / MB. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 2 : 1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

type BodyView = 'pretty' | 'raw' | 'preview'
type RespTab = 'body' | 'headers' | 'cookies' | 'tests' | 'visualize'

/** Map a content-type to a Monaco language id for the Pretty viewer. */
function languageForContentType(contentType: string | undefined): string {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('html')) return 'html'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('javascript') || ct.includes('ecmascript')) return 'javascript'
  if (ct.includes('css')) return 'css'
  return 'text'
}

/** Pretty-print JSON when possible; otherwise return the original text. */
function prettyValue(text: string, language: string): string {
  if (language !== 'json') return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** Localized label per transport-error kind (shared by the pill and the body). */
const ERROR_KIND_LABEL: Record<HttpErrorKind, string> = {
  dns: 'DNS — хост не найден',
  connect: 'Не удалось подключиться',
  tls: 'Ошибка TLS / сертификата',
  timeout: 'Превышено время ожидания',
  abort: 'Запрос отменён',
  protocol: 'Ошибка протокола',
  unknown: 'Ошибка сети'
}

/** Human title for a response or a network/transport error. */
function errorTitle(result: ResponseResult): string {
  if (result.status > 0) return `${result.status} ${result.statusText}`.trim()
  const kind = result.error?.kind
  return kind ? ERROR_KIND_LABEL[kind] : 'Ошибка сети'
}

/** Status-pill label: real status line, or the SAME error-kind label as the body. */
function statusLabel(result: ResponseResult): string {
  if (result.status > 0) return `${result.status} ${result.statusText}`.trim()
  return errorTitle(result)
}

/* ============================================================
 * Loading skeleton (ported from the design's RespLoading)
 * ============================================================ */

const SKEL_WIDTHS = [70, 92, 55, 80, 45, 88, 60, 75, 40]

function RespLoading(): JSX.Element {
  return (
    <div style={{ padding: '16px 14px' }}>
      {SKEL_WIDTHS.map((w, i) => (
        <div
          key={i}
          className="skel"
          style={{ height: 11, width: `${w}%`, marginBottom: 11, marginLeft: (i % 3) * 18 }}
        />
      ))}
    </div>
  )
}

/* ============================================================
 * Error card (rendered inside the body area)
 * ============================================================ */

function RespError({ result, onAskAI }: { result: ResponseResult; onAskAI: () => void }): JSX.Element {
  return (
    <div className="empty" style={{ alignItems: 'flex-start', paddingTop: 30 }}>
      <div className="empty-card">
        <div
          className="empty-ico"
          style={{
            color: 'var(--s-5xx)',
            background: 'color-mix(in oklch, var(--s-5xx) 12%, var(--bg-2))',
            borderColor: 'color-mix(in oklch, var(--s-5xx) 30%, transparent)'
          }}
        >
          <Icon name="warn" size={24} />
        </div>
        <h3>{errorTitle(result)}</h3>
        <p>{result.error?.message ?? 'Сервер вернул ошибку при обработке запроса. Проверьте тело запроса и заголовки — или попросите AI разобраться.'}</p>
        <div className="empty-actions">
          <button className="btn primary" onClick={onAskAI}>
            <Icon name="sparkle" size={14} />
            Спросить AI о причине
          </button>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
 * Body — Pretty (Monaco) / Raw / Preview
 * ============================================================ */

function PreviewPane({ result }: { result: ResponseResult }): JSX.Element {
  const ct = (result.body.contentType ?? '').toLowerCase()

  if (ct.startsWith('image/') && result.body.base64) {
    return (
      <div className="preview-image-wrap">
        <img src={`data:${result.body.contentType};base64,${result.body.base64}`} alt="Предпросмотр ответа" />
      </div>
    )
  }

  if (ct.includes('html') && result.body.text != null) {
    // sandbox="" disables scripts; the CSP meta further restricts the document.
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'">`
    const srcDoc = `${csp}${result.body.text}`
    return <iframe className="preview-frame" title="Предпросмотр HTML" sandbox="" srcDoc={srcDoc} />
  }

  return (
    <div className="empty">
      <div className="empty-card">
        <div className="empty-ico">
          <Icon name="eye" size={22} />
        </div>
        <p style={{ marginBottom: 0 }}>Предпросмотр недоступен для этого типа.</p>
      </div>
    </div>
  )
}

function BodyPane({
  result,
  view,
  wordWrap,
  hostRef
}: {
  result: ResponseResult
  view: BodyView
  wordWrap: boolean
  hostRef: React.RefObject<HTMLDivElement>
}): JSX.Element {
  const text = result.body.text ?? ''
  const language = languageForContentType(result.body.contentType)
  const pretty = useMemo(() => prettyValue(text, language), [text, language])

  if (view === 'preview') {
    return (
      <div ref={hostRef} style={{ height: '100%' }}>
        <PreviewPane result={result} />
      </div>
    )
  }

  if (view === 'raw') {
    return (
      <div ref={hostRef} style={{ height: '100%', overflow: 'auto' }}>
        <pre
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12.5,
            lineHeight: 1.7,
            padding: '12px 14px 24px',
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--tx-1)'
          }}
        >
          {text}
        </pre>
      </div>
    )
  }

  // Pretty — Monaco read-only editor; the host fills .resp-body (flex:1).
  return (
    <div ref={hostRef} style={{ height: '100%' }}>
      <CodeEditor value={pretty} language={language} readOnly wordWrap={wordWrap} />
    </div>
  )
}

/* ============================================================
 * Tests tab
 * ============================================================ */

function TestsPane({ r }: { r: TabResponse }): JSX.Element {
  const tests = r.testResults ?? []
  const logs = r.consoleLines ?? []

  if (tests.length === 0 && logs.length === 0) {
    return (
      <div className="empty">
        <div className="empty-card">
          <div className="empty-ico">
            <Icon name="check" size={22} />
          </div>
          <p style={{ marginBottom: 0 }}>Нет тестов. Добавьте скрипт во вкладке Tests запроса.</p>
        </div>
      </div>
    )
  }

  const passed = tests.filter((t) => t.passed).length
  const failed = tests.length - passed

  return (
    <div>
      {tests.length > 0 && (
        <div className="test-summary">
          <span className="test-badge pass">{passed} пройдено</span>
          <span className="test-badge fail">{failed} провалено</span>
        </div>
      )}
      {tests.map((t, i) => (
        <div className="test-row" key={i}>
          <Icon name={t.passed ? 'check' : 'warn'} size={15} className={`t-ico ${t.passed ? 'pass' : 'fail'}`} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{t.name}</div>
            {!t.passed && t.error && <div className="t-err">{t.error}</div>}
          </div>
        </div>
      ))}
      {logs.map((l, i) => (
        <div className={`console-line ${l.level}`} key={`log-${i}`}>
          {l.message}
        </div>
      ))}
    </div>
  )
}

/* ============================================================
 * Status bar
 * ============================================================ */

function StatusBar({
  result,
  copied,
  onCopy,
  onSave,
  onSaveExample,
  onAskAI
}: {
  result: ResponseResult
  copied: boolean
  onCopy: () => void
  onSave: () => void
  onSaveExample: () => void
  onAskAI: () => void
}): JSX.Element {
  const sc = statusColor(result.status)
  return (
    <div className="resp-statusbar">
      <span
        className="status-pill"
        style={{ color: sc, background: `color-mix(in oklch, ${sc} 14%, transparent)` }}
      >
        <span className="pulse" style={{ background: sc }} />
        {statusLabel(result)}
      </span>
      <div className="resp-meta">
        <Icon name="history" size={13} style={{ color: 'var(--tx-3)' }} />
        <b>{result.timings.totalMs} ms</b>
        <span className="sep">•</span>
        <b>{formatBytes(result.body.sizeBytes)}</b>
        <span className="sep">•</span>
        <span>{result.headers.length} headers</span>
      </div>
      <div className="resp-actions">
        <button className="ask-ai-btn" onClick={onAskAI}>
          <Icon name="sparkle" size={14} />
          Спросить AI
        </button>
        <IconButton icon={copied ? 'check' : 'copy'} title="Копировать" onClick={onCopy} />
        <IconButton icon="save" title="Сохранить в файл" onClick={onSave} />
        <IconButton icon="doc" title="Сохранить как пример" onClick={onSaveExample} />
      </div>
    </div>
  )
}

/* ============================================================
 * Tabs row (Body / Headers / Cookies / Tests + body controls)
 * ============================================================ */

function TabsRow({
  result,
  testCount,
  tab,
  onTab,
  bodyView,
  onBodyView,
  search,
  onSearch,
  onTriggerFind
}: {
  result: ResponseResult
  testCount: number
  tab: RespTab
  onTab: (t: RespTab) => void
  bodyView: BodyView
  onBodyView: (v: BodyView) => void
  search: string
  onSearch: (v: string) => void
  onTriggerFind: () => void
}): JSX.Element {
  const tabs: { id: RespTab; label: string; count?: number }[] = [
    { id: 'body', label: 'Body' },
    { id: 'headers', label: 'Headers', count: result.headers.length },
    { id: 'cookies', label: 'Cookies', count: result.cookies.length },
    { id: 'tests', label: 'Tests', count: testCount },
    { id: 'visualize', label: 'Visualize' }
  ]

  return (
    <div className="resp-tabs">
      {tabs.map((t) => (
        <button key={t.id} className={`tab${tab === t.id ? ' on' : ''}`} onClick={() => onTab(t.id)}>
          {t.label}
          {t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}

      {tab === 'body' && (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="side-search" style={{ margin: 0, height: 26, minWidth: 150 }}>
            <Icon name="search" size={12} />
            <input
              placeholder="Поиск в ответе…"
              style={{ fontSize: 12 }}
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onTriggerFind()
              }}
            />
          </div>
          <Segmented<BodyView>
            options={[
              { value: 'pretty', label: 'Pretty' },
              { value: 'raw', label: 'Raw' },
              { value: 'preview', label: 'Preview' }
            ]}
            value={bodyView}
            onChange={onBodyView}
            style={{ height: 28 }}
          />
        </div>
      )}
    </div>
  )
}

/** Hostname of a URL, or undefined when unparseable (used to focus the cookie jar). */
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

/** Small modal to name a response example before saving it onto the request. */
function ExampleNameModal({
  open,
  onOpenChange,
  defaultName,
  onSave
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  defaultName: string
  onSave: (name: string) => void
}): JSX.Element {
  const [name, setName] = useState(defaultName)
  useEffect(() => {
    if (open) setName(defaultName)
  }, [open, defaultName])
  const commit = (): void => {
    onSave(name.trim() || defaultName)
    onOpenChange(false)
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Сохранить как пример" width={420}>
      <Field label="Имя примера">
        <input
          className="input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
        />
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="btn ghost" onClick={() => onOpenChange(false)}>
          Отмена
        </button>
        <button className="btn primary" onClick={commit}>
          Сохранить
        </button>
      </div>
    </Modal>
  )
}

/* ============================================================
 * ResponsePanel
 * ============================================================ */

export function ResponsePanel({ tabId, onAskAI }: { tabId: string; onAskAI: () => void }): JSX.Element {
  const r = useResponse((s) => s.byTab[tabId]) ?? ({ status: 'empty' } as TabResponse)
  const wordWrap = useSettings((s) => s.settings.wordWrapResponse)

  const [tab, setTab] = useState<RespTab>('body')
  const [bodyView, setBodyView] = useState<BodyView>('pretty')
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)
  const [cookieMgrOpen, setCookieMgrOpen] = useState(false)
  const [exampleOpen, setExampleOpen] = useState(false)
  const bodyHostRef = useRef<HTMLDivElement>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  // ----- empty -----
  if (r.status === 'empty') {
    return (
      <div className="response" style={{ flex: 1 }}>
        <div className="empty">
          <div className="empty-card">
            <div className="empty-ico">
              <Icon name="send" size={22} />
            </div>
            <h3>Готов отправить запрос</h3>
            <p>
              Нажмите <b style={{ color: 'var(--tx-0)' }}>Отправить</b> или{' '}
              <span className="kbd">{kbd('↵')}</span> — ответ появится здесь.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ----- loading -----
  if (r.status === 'loading') {
    return (
      <div className="response" style={{ flex: 1 }}>
        <div className="resp-statusbar">
          <div className="resp-meta">
            <Icon name="refresh" size={14} className="spin" />
            Отправка запроса…
          </div>
        </div>
        <div className="resp-body">
          <RespLoading />
        </div>
      </div>
    )
  }

  // ----- done | error : we have a result -----
  const result = r.result
  if (!result) {
    // Defensive: status says done/error but no payload yet.
    return (
      <div className="response" style={{ flex: 1 }}>
        <div className="resp-body">
          <RespLoading />
        </div>
      </div>
    )
  }

  const copyBody = (): void => {
    void navigator.clipboard.writeText(result.body.text ?? '')
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1200)
  }

  const saveBody = (): void => {
    void window.api.saveFile({
      defaultName: 'response',
      content: result.body.base64 ?? result.body.text ?? '',
      base64: !!result.body.base64
    })
  }

  // Trigger Monaco's native find widget on the visible response editor (Pretty view).
  const triggerFind = (): void => {
    const host = bodyHostRef.current
    if (!host) return
    const editor = monaco.editor.getEditors().find((ed) => {
      const node = ed.getDomNode()
      return node ? host.contains(node) : false
    })
    if (!editor) return
    editor.focus()
    void editor.getAction('actions.find')?.run()
  }

  const testCount = r.testResults?.length ?? 0
  const isError = r.status === 'error' || !!result.error

  return (
    <div className="response" style={{ flex: 1 }}>
      <StatusBar
        result={result}
        copied={copied}
        onCopy={copyBody}
        onSave={saveBody}
        onSaveExample={() => setExampleOpen(true)}
        onAskAI={onAskAI}
      />

      <TabsRow
        result={result}
        testCount={testCount}
        tab={tab}
        onTab={setTab}
        bodyView={bodyView}
        onBodyView={setBodyView}
        search={search}
        onSearch={setSearch}
        onTriggerFind={triggerFind}
      />

      <CookieManager open={cookieMgrOpen} onOpenChange={setCookieMgrOpen} initialDomain={hostOf(result.finalUrl)} />
      <ExampleNameModal
        open={exampleOpen}
        onOpenChange={setExampleOpen}
        defaultName={statusLabel(result)}
        onSave={(name) => {
          saveResponseExample(name, result)
          useUi.getState().showToast('Пример сохранён')
        }}
      />

      <div className="resp-body">
        {tab === 'body' &&
          (isError ? (
            <RespError result={result} onAskAI={onAskAI} />
          ) : (
            <BodyPane result={result} view={bodyView} wordWrap={wordWrap} hostRef={bodyHostRef} />
          ))}

        {tab === 'visualize' && <VisualizerTab payload={r.visualizer} result={result} />}

        {tab === 'headers' && (
          <table className="resp-table">
            <thead>
              <tr>
                <th>Header</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {result.headers.map(([k, v], i) => (
                <tr key={i}>
                  <td className="hk">{k}</td>
                  <td className="hv">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'cookies' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px' }}>
              <span style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
                Set-Cookie из этого ответа. Постоянное хранилище — в менеджере.
              </span>
              <button className="btn ghost" style={{ height: 28 }} onClick={() => setCookieMgrOpen(true)}>
                <Icon name="cookie" size={14} />
                Управление cookies
              </button>
            </div>
            {result.cookies.length > 0 ? (
              <table className="resp-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Value</th>
                    <th>Domain</th>
                    <th>Path</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {result.cookies.map((c, i) => (
                    <tr key={i}>
                      <td className="hk">{c.name}</td>
                      <td className="hv">{c.value}</td>
                      <td className="hv">{c.domain ?? ''}</td>
                      <td className="hv">{c.path ?? ''}</td>
                      <td className="hv">{c.expires ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--tx-3)' }}>
                В этом ответе нет Set-Cookie.
              </div>
            )}
          </div>
        )}

        {tab === 'tests' && <TestsPane r={r} />}
      </div>
    </div>
  )
}
