import { useState } from 'react'
import type { RequestModel } from '@shared/types'
import { CodeEditor } from '@renderer/components/CodeEditor'
import { useTabs } from '@renderer/store/tabs'

export function ScriptsTab({ req }: { req: RequestModel }) {
  const patch = useTabs((s) => s.patchActive)
  const [which, setWhich] = useState<'pre' | 'test'>('pre')

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="subbar">
        <div className="seg">
          <button className={which === 'pre' ? 'on' : ''} onClick={() => setWhich('pre')}>
            Pre-request
          </button>
          <button className={which === 'test' ? 'on' : ''} onClick={() => setWhich('test')}>
            Tests
          </button>
        </div>
        <span className="label" style={{ marginLeft: 'auto' }}>
          API: <span className="mono">pm.environment</span>, <span className="mono">pm.response</span>, <span className="mono">pm.test</span>,{' '}
          <span className="mono">pm.expect</span>
        </span>
      </div>
      {which === 'pre' ? (
        <div className="code-editor" style={{ height: 300 }}>
          <CodeEditor
            value={req.preRequestScript ?? ''}
            language="javascript"
            onChange={(v) => patch({ preRequestScript: v })}
          />
        </div>
      ) : (
        <div className="code-editor" style={{ height: 300 }}>
          <CodeEditor value={req.testScript ?? ''} language="javascript" onChange={(v) => patch({ testScript: v })} />
        </div>
      )}
    </div>
  )
}
