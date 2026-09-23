import { useCallback, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useSecretNames } from '@renderer/lib/hooks'
import { currentScope } from '@renderer/lib/request-runner'
import { applyVarSuggestion, suggestVars, varQueryAt, type VarQuery, type VarSuggestion } from '@renderer/lib/var-suggest'
import { tr } from '@renderer/lib/i18n'
import type { CodeEditorProps } from './CodeEditorMonaco'
import '@renderer/styles/feat-varsuggest.css'

const SOURCE_LABELS: Record<VarSuggestion['source'], string> = {
  local: 'локальная',
  collection: 'коллекция',
  environment: 'окружение',
  global: 'глобальная',
  dynamic: 'динамическая'
}

const POPUP_MAX_HEIGHT = 260

/**
 * The editor used in low-power mode: a textarea instead of Monaco.
 *
 * Monaco is several megabytes of code plus web workers, and it repaints a lot;
 * on a weak machine that is the difference between usable and not. Everything
 * the editor is *for* survives the swap — typing, pasting, tabs, word wrap,
 * read-only views and the `{{` variable autocomplete, which comes from the same
 * pure module the Monaco and single-line input completions use. What is lost is
 * decoration only: syntax colours, folding and the line-number gutter.
 */
export function CodeEditorPlain({ value, onChange, readOnly = false, wordWrap = false, placeholder }: CodeEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const secrets = useSecretNames()
  const [query, setQuery] = useState<VarQuery | null>(null)
  const [items, setItems] = useState<VarSuggestion[]>([])
  const [box, setBox] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const [active, setActive] = useState(0)
  const open = query !== null && items.length > 0
  const suggestible = !readOnly && !!onChange

  const close = useCallback(() => {
    setQuery(null)
    setItems([])
    setBox(null)
  }, [])

  /** Re-read the caret and decide whether a suggestion list is due. */
  const refresh = useCallback(
    (text: string, caret: number | null) => {
      if (!suggestible || caret === null) return close()
      const q = varQueryAt(text, caret)
      if (!q) return close()
      const found = suggestVars(q.query, currentScope(), { secrets })
      if (!found.length) return close()
      const el = ref.current
      if (el) {
        // A textarea gives no caret coordinates, so the list is anchored to the
        // editor box — close enough to read, and it never covers the caret line
        // when there is room below.
        const r = el.getBoundingClientRect()
        const below = window.innerHeight - r.bottom
        const above = below < POPUP_MAX_HEIGHT + 16 && r.top > below
        setBox({ left: r.left + 8, top: above ? r.top - 4 : r.bottom + 4, above })
      }
      setQuery(q)
      setItems(found)
      setActive(0)
    },
    [close, secrets, suggestible]
  )

  const accept = useCallback(
    (name: string) => {
      const el = ref.current
      if (!el || !query) return
      const next = applyVarSuggestion(el.value, query, name)
      onChange?.(next.value)
      close()
      // The value round-trips through the parent, so the caret is restored once
      // the new text is on screen.
      requestAnimationFrame(() => {
        const node = ref.current
        if (!node) return
        node.focus()
        node.setSelectionRange(next.caret, next.caret)
      })
    },
    [close, onChange, query]
  )

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        accept(items[active].name)
        return
      }
      if (e.key === 'Escape') {
        // Only the list closes — not the dialog the editor may sit in.
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
    }
    // Tab indents instead of leaving the editor, as it does in Monaco.
    if (e.key === 'Tab' && !readOnly) {
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart: start, selectionEnd: end } = el
      const next = `${el.value.slice(0, start)}  ${el.value.slice(end)}`
      onChange?.(next)
      requestAnimationFrame(() => {
        const node = ref.current
        if (!node) return
        node.setSelectionRange(start + 2, start + 2)
      })
    }
  }

  const popup =
    open && box
      ? createPortal(
          <div
            className="var-suggest"
            style={{ left: box.left, width: 320, ...(box.above ? { bottom: window.innerHeight - box.top } : { top: box.top }) }}
            role="listbox"
            onMouseDown={(e) => e.preventDefault()}
          >
            {items.map((s, i) => (
              <div
                key={`${s.source}:${s.name}`}
                className={`var-suggest-row${i === active ? ' on' : ''}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => accept(s.name)}
              >
                <span className="var-suggest-name mono">{s.name}</span>
                {s.value !== undefined && <span className="var-suggest-val mono">{s.secret ? '••••••••' : s.value || tr('пусто')}</span>}
                <span className="var-suggest-src">{tr(SOURCE_LABELS[s.source])}</span>
              </div>
            ))}
            <div className="var-suggest-foot">{tr('↑↓ — выбрать, Enter или Tab — вставить, Esc — скрыть')}</div>
          </div>,
          document.body
        )
      : null

  return (
    <div className="monaco-host">
      <textarea
        ref={ref}
        className="plain-editor"
        data-wrap={wordWrap ? 'on' : 'off'}
        spellCheck={false}
        readOnly={readOnly}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange?.(e.target.value)
          refresh(e.target.value, e.target.selectionStart)
        }}
        onKeyUp={(e) => refresh(e.currentTarget.value, e.currentTarget.selectionStart)}
        onClick={(e) => refresh(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      {popup}
    </div>
  )
}
