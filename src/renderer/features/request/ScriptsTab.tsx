import { useState } from 'react'
import type { RequestModel } from '@shared/types'
import { CodeEditor } from '@renderer/components/CodeEditor'
import { Icon } from '@renderer/components/Icon'
import { useTabs } from '@renderer/store/tabs'
import { SNIPPETS } from '@renderer/lib/snippets'

export function ScriptsTab({ req, tabId }: { req: RequestModel; tabId: string }) {
  const patch = (p: Partial<RequestModel>) => useTabs.getState().patchTab(tabId, p)
  const [which, setWhich] = useState<'pre' | 'test'>('pre')
  const [showSnippets, setShowSnippets] = useState(true)

  const field = which === 'pre' ? 'preRequestScript' : 'testScript'
  const value = (which === 'pre' ? req.preRequestScript : req.testScript) ?? ''

  // Snippets for the current phase (phase 'both' shows in either).
  const snippets = SNIPPETS.filter((s) => s.phase === 'both' || s.phase === which)

  const insert = (code: string): void => {
    const next = value.trim() ? `${value.replace(/\s*$/, '')}\n\n${code}` : code
    patch({ [field]: next } as Partial<RequestModel>)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="subbar">
        <div className="seg">
          <button className={which === 'pre' ? 'on' : ''} onClick={() => setWhich('pre')}>
            Pre-request
          </button>
          <button className={which === 'test' ? 'on' : ''} onClick={() => setWhich('test')}>
            Post-response
          </button>
        </div>
        <span className="label">
          {which === 'pre' ? 'Выполняется ДО отправки' : 'Выполняется ПОСЛЕ ответа (тесты)'} · API:{' '}
          <span className="mono">pm.test</span>, <span className="mono">pm.expect</span>, <span className="mono">pm.response</span>
        </span>
        <button
          className={`btn ghost ${showSnippets ? 'on' : ''}`}
          style={{ height: 26, marginLeft: 'auto' }}
          onClick={() => setShowSnippets((v) => !v)}
          title="Готовые сниппеты тестов"
        >
          <Icon name="code2" size={13} />
          Сниппеты
        </button>
      </div>

      <div style={{ display: 'flex', gap: 0, minHeight: 0 }}>
        <div className="code-editor" style={{ height: 300, flex: 1, marginRight: showSnippets ? 8 : 14 }}>
          <CodeEditor value={value} language="javascript" onChange={(v) => patch({ [field]: v } as Partial<RequestModel>)} />
        </div>
        {showSnippets && (
          <div className="snippet-panel">
            <div className="snippet-head">Сниппеты</div>
            {snippets.map((s) => (
              <button key={s.id} className="snippet-item" title="Вставить сниппет" onClick={() => insert(s.code)}>
                <Icon name="plus" size={12} />
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
