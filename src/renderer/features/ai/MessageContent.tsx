import { Fragment, useEffect, useRef, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { CodeEditorHl } from './CodeEditorHl'
import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'
import { parseHttpBlock } from '@renderer/lib/parse-http'
import { parseCurl } from '@shared/curl'

interface Segment {
  type: 'text' | 'code'
  lang?: string
  content: string
}

function splitSegments(text: string): Segment[] {
  const segs: Segment[] = []
  const re = /```([\w-]*)\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ type: 'text', content: text.slice(last, m.index) })
    segs.push({ type: 'code', lang: (m[1] || 'text').toLowerCase(), content: m[2].replace(/\n$/, '') })
    last = re.lastIndex
  }
  if (last < text.length) segs.push({ type: 'text', content: text.slice(last) })
  return segs
}

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (/^\*\*.*\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (/^`.*`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>
    return <Fragment key={i}>{p}</Fragment>
  })
}

function TextBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: JSX.Element[] = []
  let list: string[] = []
  const flush = (key: number) => {
    if (list.length) {
      out.push(
        <ul key={`ul${key}`}>
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (/^[-*]\s+/.test(trimmed)) {
      list.push(trimmed.replace(/^[-*]\s+/, ''))
    } else {
      flush(i)
      if (trimmed) out.push(<p key={i}>{inline(line)}</p>)
    }
  })
  flush(lines.length)
  return <>{out}</>
}

export function MessageContent({ content }: { content: string }) {
  const segs = splitSegments(content)
  return (
    <>
      {segs.map((s, i) =>
        s.type === 'text' ? <TextBlock key={i} text={s.content} /> : <CodeArtifact key={i} lang={s.lang!} code={s.content} />
      )}
    </>
  )
}

function CodeArtifact({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()
  const patch = useTabs((s) => s.patchActive)
  const openNew = useTabs((s) => s.openNew)
  const showToast = useUi((s) => s.showToast)

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const copy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1200)
  }

  const isCurl = (lang === 'bash' || lang === 'sh' || lang === 'shell') && /curl\s/i.test(code)

  const apply = () => {
    if (lang === 'http') {
      const p = parseHttpBlock(code)
      // Require a request line (method or URL) — otherwise parseHttpBlock would
      // happily turn arbitrary prose into a "body" and overwrite the request.
      if (!p.url && !p.method) {
        showToast('Не удалось разобрать ```http блок')
        return
      }
      patch(p)
      showToast('Применено к текущему запросу')
    } else if (isCurl) {
      const { request } = parseCurl(code)
      openNew(request)
      showToast('Импортировано как новый запрос')
    } else if (lang === 'javascript' || lang === 'js') {
      patch({ testScript: code })
      showToast('Вставлено как тест-скрипт')
    } else if (lang === 'json') {
      // Set the body AND a matching Content-Type, preserving other headers.
      const cur = useTabs.getState().activeTab()?.request.headers ?? []
      const headers = cur.filter((h) => h.key.toLowerCase() !== 'content-type')
      headers.push({ key: 'Content-Type', value: 'application/json', enabled: true })
      patch({ body: { type: 'raw', language: 'json', text: code }, headers })
      showToast('Применено как тело запроса')
    }
  }

  const applyLabel =
    lang === 'http'
      ? 'Применить к запросу'
      : isCurl
        ? 'Импортировать запрос'
        : lang === 'javascript' || lang === 'js'
          ? 'Вставить как тест'
          : lang === 'json'
            ? 'Применить как тело'
            : null

  return (
    <div className="ai-code">
      <div className="ai-code-head">
        <span className="lang">{lang}</span>
        <button className="icon-btn" style={{ width: 24, height: 22 }} onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} size={13} />
        </button>
      </div>
      <pre>
        <CodeEditorHl code={code} lang={lang} />
      </pre>
      {applyLabel && (
        <div className="ai-apply" style={{ padding: '0 8px 8px' }}>
          <button className="sug-chip" onClick={apply}>
            <Icon name="bolt" size={13} />
            {applyLabel}
          </button>
        </div>
      )}
    </div>
  )
}
