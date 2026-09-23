import { lazy, Suspense } from 'react'
import { lowPowerActive } from '@renderer/store/settings'
import type { CodeEditorProps } from './CodeEditorMonaco'
import { CodeEditorPlain } from './CodeEditorPlain'
import '@renderer/styles/low-power.css'

/**
 * Lazy boundary in front of Monaco.
 *
 * Monaco is by far the heaviest dependency in the renderer — several megabytes
 * of code plus its web workers. Loading it only when an editor is actually on
 * screen keeps it out of startup entirely: a session that never opens a body,
 * a script or a pretty-printed response never pays for it, and one that does
 * pays after the first paint rather than before it.
 *
 * In low-power mode Monaco is not loaded at all: a plain textarea with the same
 * `{{` autocomplete takes its place (see CodeEditorPlain).
 */
const Impl = lazy(() => import('./CodeEditorMonaco').then((m) => ({ default: m.CodeEditorMonaco })))

export type { CodeEditorProps }

export function CodeEditor(props: CodeEditorProps): JSX.Element {
  if (lowPowerActive()) return <CodeEditorPlain {...props} />
  return (
    <Suspense fallback={<div className="monaco-host monaco-loading" />}>
      <Impl {...props} />
    </Suspense>
  )
}
