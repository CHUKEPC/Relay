import '../lib/monaco'
import Editor, { type OnMount } from '@monaco-editor/react'
import { attachVarTrigger, ensureVarCompletion } from '../lib/var-completion'
import { useEffect, useRef, useState } from 'react'
import { makeId } from '@shared/id'
import { recallScroll, rememberScroll } from '../lib/view-memory'

export interface CodeEditorProps {
  value: string
  language?: string
  onChange?: (value: string) => void
  readOnly?: boolean
  /** show line numbers + folding (full editor) vs. minimal */
  minimal?: boolean
  wordWrap?: boolean
  placeholder?: string
  /**
   * Remember the scroll position under this key (see lib/view-memory): an editor
   * rebuilt when its tab is shown again comes back where it was left.
   */
  viewKey?: string
}

function currentTheme(): 'relay-dark' | 'relay-light' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'relay-light' : 'relay-dark'
}

/** Shared Monaco wrapper that tracks the app theme and matches the design. */
export function CodeEditorMonaco({ value, language = 'json', onChange, readOnly = false, minimal = false, wordWrap = false, viewKey }: CodeEditorProps) {
  const [theme, setTheme] = useState(currentTheme)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const viewKeyRef = useRef(viewKey)
  viewKeyRef.current = viewKey
  /** while a remembered position is being applied, scroll events are not saved */
  const restoringRef = useRef(false)

  /** Scroll to where `key` was left (the top for a key never seen). */
  const restoreScroll = (editor: Parameters<OnMount>[0], key: string): void => {
    const pos = recallScroll(key)
    const apply = (): void => editor.setScrollPosition({ scrollTop: pos?.top ?? 0, scrollLeft: pos?.left ?? 0 })
    restoringRef.current = true
    apply()
    // The first layout may not know the content height yet: apply once more after it.
    requestAnimationFrame(() => {
      apply()
      restoringRef.current = false
    })
  }

  // A new key on a mounted editor (another response in the same panel).
  useEffect(() => {
    if (editorRef.current && viewKey) restoreScroll(editorRef.current, viewKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey])
  // A unique model URI per instance — without `path`, every <Editor> resolves to
  // the SAME default model (Uri.parse("")) and they share/dispose one another's text.
  const pathRef = useRef<string>()
  if (!pathRef.current) pathRef.current = `inmemory://relay/${makeId('editor')}`

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(currentTheme()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  return (
    <div className="monaco-host">
      <Editor
        path={pathRef.current}
        saveViewState={false}
        value={value}
        language={language}
        theme={theme}
        onChange={(v) => onChange?.(v ?? '')}
        onMount={(editor) => {
          editorRef.current = editor
          // `{{` completion, same variable list the request fields offer.
          ensureVarCompletion()
          if (!readOnly) attachVarTrigger(editor)
          if (viewKeyRef.current) restoreScroll(editor, viewKeyRef.current)
          editor.onDidScrollChange((e) => {
            const key = viewKeyRef.current
            if (key && !restoringRef.current) rememberScroll(key, { top: e.scrollTop, left: e.scrollLeft })
          })
        }}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          lineHeight: 20,
          fontLigatures: false,
          lineNumbers: minimal ? 'off' : 'on',
          folding: !minimal,
          glyphMargin: false,
          lineDecorationsWidth: minimal ? 0 : 8,
          lineNumbersMinChars: minimal ? 0 : 3,
          renderLineHighlight: 'line',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: wordWrap ? 'on' : 'off',
          padding: { top: 10, bottom: 10 },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
          overviewRulerLanes: 0,
          guides: { indentation: false },
          contextmenu: false,
          stickyScroll: { enabled: false }
        }}
      />
    </div>
  )
}
