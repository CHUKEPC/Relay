import '../lib/monaco'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'

export interface CodeEditorProps {
  value: string
  language?: string
  onChange?: (value: string) => void
  readOnly?: boolean
  /** show line numbers + folding (full editor) vs. minimal */
  minimal?: boolean
  wordWrap?: boolean
  placeholder?: string
}

function currentTheme(): 'relay-dark' | 'relay-light' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'relay-light' : 'relay-dark'
}

/** Shared Monaco wrapper that tracks the app theme and matches the design. */
export function CodeEditor({ value, language = 'json', onChange, readOnly = false, minimal = false, wordWrap = false }: CodeEditorProps) {
  const [theme, setTheme] = useState(currentTheme)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)

  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(currentTheme()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  return (
    <div className="monaco-host">
      <Editor
        value={value}
        language={language}
        theme={theme}
        onChange={(v) => onChange?.(v ?? '')}
        onMount={(editor) => {
          editorRef.current = editor
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
