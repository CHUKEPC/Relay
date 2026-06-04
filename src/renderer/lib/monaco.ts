/**
 * Monaco setup for Electron + Vite: load workers from the bundle (no CDN) and
 * register Relay light/dark themes. Importing this module configures the
 * `@monaco-editor/react` loader to use the locally-bundled monaco instance.
 */
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { loader } from '@monaco-editor/react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(self as any).MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    switch (label) {
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        return new editorWorker()
    }
  }
}

monaco.editor.defineTheme('relay-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'string.key.json', foreground: '8ab4f8' },
    { token: 'string.value.json', foreground: '83d6a6' },
    { token: 'string', foreground: '83d6a6' },
    { token: 'number', foreground: 'e3b574' },
    { token: 'keyword.json', foreground: 'c79bf2' },
    { token: 'keyword', foreground: 'c79bf2' }
  ],
  colors: {
    'editor.background': '#15161a',
    'editor.foreground': '#e6e6ea',
    'editorLineNumber.foreground': '#54555f',
    'editorLineNumber.activeForeground': '#9a9ba6',
    'editor.lineHighlightBackground': '#1d1e24',
    'editorIndentGuide.background1': '#26272d',
    'editor.selectionBackground': '#33415580',
    'editorCursor.foreground': '#7c8cff',
    'editorWidget.background': '#1d1e24',
    'editorWidget.border': '#2a2b31'
  }
})

monaco.editor.defineTheme('relay-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'string.key.json', foreground: '3b4fb0' },
    { token: 'string.value.json', foreground: '2f8a5a' },
    { token: 'string', foreground: '2f8a5a' },
    { token: 'number', foreground: 'a0651f' },
    { token: 'keyword.json', foreground: '8b3fb0' }
  ],
  colors: {
    'editor.background': '#fcfcfd',
    'editor.foreground': '#2a2a30',
    'editorLineNumber.foreground': '#b8b9c2',
    'editor.lineHighlightBackground': '#f2f2f5'
  }
})

loader.config({ monaco })

export { monaco }
