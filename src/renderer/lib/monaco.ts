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

const STATIC_THEMES: Record<'dark' | 'light', monaco.editor.IStandaloneThemeData> = {
  dark: {
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
  },
  light: {
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
  }
}

/** A CSS colour (oklch, rgb(), …) as #rrggbb, flattened onto `behind` when translucent. */
function toHex(css: string, behind?: string): string | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx || !css) return null
    if (behind) {
      ctx.fillStyle = behind
      ctx.fillRect(0, 0, 1, 1)
    }
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/**
 * Editor colours for a pack or custom theme, read from the tokens the theme
 * just applied, so the code editors match the rest of the window.
 */
function derivedTheme(mode: 'dark' | 'light'): monaco.editor.IStandaloneThemeData {
  const css = getComputedStyle(document.documentElement)
  const token = (name: string): string => css.getPropertyValue(name).trim()
  const bg = toHex(token('--code-bg')) ?? (mode === 'dark' ? '#15161a' : '#fcfcfd')
  const hex = (name: string, fallback: string): string => (toHex(token(name), bg) ?? fallback).slice(1)
  const fg = hex('--tx-0', mode === 'dark' ? '#e6e6ea' : '#2a2a30')
  return {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: hex('--c-key', '#8ab4f8') },
      { token: 'string.value.json', foreground: hex('--c-str', '#83d6a6') },
      { token: 'string', foreground: hex('--c-str', '#83d6a6') },
      { token: 'number', foreground: hex('--c-num', '#e3b574') },
      { token: 'keyword.json', foreground: hex('--c-bool', '#c79bf2') },
      { token: 'keyword', foreground: hex('--c-bool', '#c79bf2') },
      { token: 'comment', foreground: hex('--tx-3', '#6b6d78') },
      { token: 'delimiter', foreground: hex('--c-punct', '#8a8c97') }
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': '#' + fg,
      'editorLineNumber.foreground': '#' + hex('--tx-3', '#54555f'),
      'editorLineNumber.activeForeground': '#' + hex('--tx-1', '#9a9ba6'),
      'editor.lineHighlightBackground': '#' + hex('--bg-hover', '#1d1e24'),
      'editorIndentGuide.background1': '#' + hex('--line', '#26272d'),
      'editor.selectionBackground': '#' + hex('--accent-soft-2', '#334155') + 'cc',
      'editorCursor.foreground': '#' + hex('--accent', '#7c8cff'),
      'editorWidget.background': '#' + hex('--bg-2', '#1d1e24'),
      'editorWidget.border': '#' + hex('--line-2', '#2a2b31')
    }
  }
}

/**
 * (Re)define relay-dark / relay-light: the hand-tuned palettes for the Relay
 * look, derived ones while a pack or custom theme is active. Runs on every
 * appearance change, so switching themes recolours open editors immediately.
 */
function syncEditorTheme(): void {
  const root = document.documentElement
  const mode = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
  const preset = root.getAttribute('data-preset')
  const themed = preset === 'pack' || preset === 'custom'
  for (const m of ['dark', 'light'] as const) {
    monaco.editor.defineTheme(`relay-${m}`, themed && m === mode ? derivedTheme(m) : STATIC_THEMES[m])
  }
  monaco.editor.setTheme(`relay-${mode}`)
}

syncEditorTheme()
window.addEventListener('relay:appearance', syncEditorTheme)

loader.config({ monaco })

export { monaco }
