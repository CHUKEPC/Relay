import { Fragment } from 'react'

/** Tiny JSON-ish highlighter for AI chat code blocks (no Monaco needed). */
export function CodeEditorHl({ code, lang }: { code: string; lang: string }) {
  if (lang !== 'json' && lang !== 'http') return <>{code}</>
  const re = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|([{}[\],])|(\s+)|(.)/g
  const out: JSX.Element[] = []
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(code)) !== null) {
    let cls: string | null = null
    if (m[1]) cls = 'c-key'
    else if (m[2]) cls = 'c-str'
    else if (m[3]) cls = 'c-bool'
    else if (m[4]) cls = 'c-null'
    else if (m[5]) cls = 'c-num'
    else if (m[6]) cls = 'c-punct'
    out.push(
      cls ? (
        <span key={i++} className={cls}>
          {m[0]}
        </span>
      ) : (
        <Fragment key={i++}>{m[0]}</Fragment>
      )
    )
  }
  return <>{out}</>
}
