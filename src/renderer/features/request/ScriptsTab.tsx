import { useMemo, useState } from 'react'
import type { RequestModel } from '@shared/types'
import type { PackSnippet } from '@shared/pack-data'
import { CodeEditor } from '@renderer/components/CodeEditor'
import { Icon } from '@renderer/components/Icon'
import { useTabs } from '@renderer/store/tabs'
import { useCap, useFeatures } from '@renderer/store/features'

import { tr } from '@renderer/lib/i18n'

/** Snippets for one script phase, in pack order, grouped by their heading. */
function groupSnippets(snippets: PackSnippet[], phase: 'pre' | 'test'): { group: string; items: PackSnippet[] }[] {
  const groups: { group: string; items: PackSnippet[] }[] = []
  for (const s of snippets) {
    if (s.phase !== 'both' && s.phase !== phase) continue
    const name = s.group ?? ''
    let g = groups.find((x) => x.group === name)
    if (!g) groups.push((g = { group: name, items: [] }))
    g.items.push(s)
  }
  return groups
}

export function ScriptsTab({ req, tabId }: { req: RequestModel; tabId: string }) {
  const patch = (p: Partial<RequestModel>) => useTabs.getState().patchTab(tabId, p)
  const [which, setWhich] = useState<'pre' | 'test'>('pre')
  const [showSnippets, setShowSnippets] = useState(true)
  // Snippets ship in the «Сниппеты для скриптов» pack; without it the panel
  // and its toggle are simply not there.
  const hasSnippets = useCap('snippets')
  const allSnippets = useFeatures((s) => s.snippets)

  const field = which === 'pre' ? 'preRequestScript' : 'testScript'
  const value = (which === 'pre' ? req.preRequestScript : req.testScript) ?? ''
  const groups = useMemo(() => groupSnippets(allSnippets, which), [allSnippets, which])
  const panelOpen = hasSnippets && showSnippets

  const insert = (code: string): void => {
    const next = value.trim() ? `${value.replace(/\s*$/, '')}\n\n${code}` : code
    patch({ [field]: next } as Partial<RequestModel>)
  }

  return (
    <div className="tab-fill">
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
          {which === 'pre' ? tr('Выполняется ДО отправки') : tr('Выполняется ПОСЛЕ ответа (тесты)')} · API:{' '}
          <span className="mono">pm.test</span>, <span className="mono">pm.expect</span>, <span className="mono">pm.response</span>
        </span>
        {hasSnippets && (
          <button
            className={`btn ghost ${showSnippets ? 'on' : ''}`}
            style={{ height: 26, marginLeft: 'auto' }}
            onClick={() => setShowSnippets((v) => !v)}
            title={tr('Готовые сниппеты тестов')}
          >
            <Icon name="code2" size={13} /> {tr('Сниппеты')}
          </button>
        )}
      </div>

      <div className="scripts-row">
        <div className="code-editor grow" style={{ marginRight: panelOpen ? 8 : 14 }}>
          <CodeEditor value={value} language="javascript" onChange={(v) => patch({ [field]: v } as Partial<RequestModel>)} />
        </div>
        {panelOpen && (
          <div className="snippet-panel">
            <div className="snippet-head">{tr('Сниппеты')}</div>
            {groups.length === 0 && <div className="snippet-empty">{tr('Для этого скрипта сниппетов нет')}</div>}
            {groups.map((g) => (
              <div key={g.group || '_'} className="snippet-group">
                {g.group && <div className="snippet-group-title">{tr(g.group)}</div>}
                {g.items.map((s) => (
                  <button key={s.id} className="snippet-item" title={tr('Вставить сниппет')} onClick={() => insert(s.code)}>
                    <Icon name="plus" size={12} />
                    <span>{tr(s.label)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
