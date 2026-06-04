import { useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useUi, type SideTab } from '@renderer/store/ui'
import { CollectionsTree } from './CollectionsTree'
import { HistoryList } from './HistoryList'
import { EnvList } from './EnvList'

const NAV: { id: SideTab; label: string; icon: string }[] = [
  { id: 'collections', label: 'Коллекции', icon: 'collections' },
  { id: 'history', label: 'История', icon: 'history' },
  { id: 'env', label: 'Среды', icon: 'env' }
]

export function Sidebar() {
  const sideTab = useUi((s) => s.sideTab)
  const setSideTab = useUi((s) => s.setSideTab)
  const openSettings = useUi((s) => s.openSettings)
  const [query, setQuery] = useState('')

  return (
    <aside className="sidebar">
      <div className="side-nav">
        <div className="seg">
          {NAV.map((t) => (
            <button
              key={t.id}
              className={sideTab === t.id ? 'on' : ''}
              onClick={() => {
                setSideTab(t.id)
                setQuery('') // don't carry one tab's search into another
              }}
              title={t.label}
            >
              <Icon name={t.icon} size={14} />
            </button>
          ))}
        </div>
      </div>

      {sideTab !== 'env' && (
        <div className="side-search">
          <Icon name="search" size={14} />
          <input
            placeholder={sideTab === 'collections' ? 'Поиск запросов…' : 'Поиск в истории…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {sideTab === 'collections' && <CollectionsTree query={query} />}
      {sideTab === 'history' && <HistoryList query={query} />}
      {sideTab === 'env' && <EnvList />}

      <div style={{ marginTop: 'auto', padding: 10, borderTop: '1px solid var(--line)' }}>
        <button className="tree-row" style={{ width: '100%' }} onClick={() => openSettings()}>
          <span className="twirl">
            <Icon name="settings" size={15} />
          </span>
          <span className="name">Настройки</span>
          <span className="kbd">⌘,</span>
        </button>
      </div>
    </aside>
  )
}
