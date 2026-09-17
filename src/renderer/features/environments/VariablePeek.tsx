import { useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Icon } from '@renderer/components/Icon'
import { useEnvironments } from '@renderer/store/environments'
import { useCollections } from '@renderer/store/collections'
import { useTabs } from '@renderer/store/tabs'
import { useUi } from '@renderer/store/ui'
import { tr, trf } from '@renderer/lib/i18n'
import '@renderer/styles/feat-varpeek.css'

type Source = 'collection' | 'environment' | 'global'

interface Row {
  key: string
  value: string
  secret: boolean
  source: Source
  /** shadowed by a higher-precedence scope with the same name */
  overridden: boolean
}

const SOURCE_LABEL: Record<Source, string> = {
  collection: 'Коллекция',
  environment: 'Окружение',
  global: 'Глобальные'
}

/**
 * The current variable state at a glance: what the active environment, the
 * collection of the open request and the globals resolve to right now, in
 * Postman's precedence order — so a script that wrote a token is visible
 * without opening the environment editor.
 */
export function VariablePeek(): JSX.Element {
  const env = useEnvironments((s) => s.env)
  const globals = useEnvironments((s) => s.globals)
  const tabs = useTabs((s) => s.doc)
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  const activeEnv = env.environments.find((e) => e.id === env.activeEnvironmentId) ?? null
  const savedRequestId = tabs.tabs.find((t) => t.id === tabs.activeTabId)?.savedRequestId ?? null

  const rows = useMemo<Row[]>(() => {
    const collectionVars = useCollections.getState().collectionScopeFor(savedRequestId)
    const out: Row[] = []
    const seen = new Set<string>()
    // Highest precedence first, so a name met again is the shadowed one.
    for (const [key, value] of Object.entries(collectionVars)) {
      out.push({ key, value, secret: false, source: 'collection', overridden: false })
      seen.add(key)
    }
    for (const v of activeEnv?.variables ?? []) {
      if (!v.enabled || !v.key) continue
      out.push({ key: v.key, value: v.value, secret: v.secret === true, source: 'environment', overridden: seen.has(v.key) })
      seen.add(v.key)
    }
    for (const v of globals.variables) {
      if (!v.enabled || !v.key) continue
      out.push({ key: v.key, value: v.value, secret: v.secret === true, source: 'global', overridden: seen.has(v.key) })
      seen.add(v.key)
    }
    const needle = query.trim().toLowerCase()
    return needle ? out.filter((r) => r.key.toLowerCase().includes(needle) || r.value.toLowerCase().includes(needle)) : out
  }, [activeEnv, globals, savedRequestId, query])

  const copy = (row: Row): void => {
    void navigator.clipboard
      .writeText(row.value)
      .then(() => useUi.getState().showToast(trf('Значение {name} скопировано', { name: row.key })))
      .catch(() => useUi.getState().showToast(tr('Не удалось скопировать'), 'error'))
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="icon-btn nodrag" title={tr('Показать переменные текущего окружения')}>
          <Icon name="eye" size={15} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover varpeek" align="end" sideOffset={6}>
          <div className="varpeek-head">
            <span className="varpeek-title">
              {activeEnv ? trf('Окружение «{name}»', { name: tr(activeEnv.name) }) : tr('Окружение не выбрано')}
            </span>
            <button
              className="btn ghost varpeek-edit"
              onClick={() => {
                useUi.getState().setSideTab('env')
                useUi.getState().setSidebarCollapsed(false)
              }}
            >
              <Icon name="pencil" size={12} /> {tr('Изменить')}
            </button>
          </div>

          <div className="side-search varpeek-search">
            <Icon name="search" size={12} />
            <input placeholder={tr('Фильтр по имени или значению')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="varpeek-list">
            {rows.map((row) => {
              const id = `${row.source}:${row.key}`
              const shown = row.secret && !revealed[id] ? '••••••••' : row.value
              return (
                <div className={`varpeek-row${row.overridden ? ' overridden' : ''}`} key={id}>
                  <span className="varpeek-key mono" title={row.overridden ? tr('Перекрыто областью выше') : row.key}>
                    {row.key}
                  </span>
                  <span className="varpeek-val mono" title={row.secret && !revealed[id] ? tr('Секрет — нажмите глаз, чтобы показать') : row.value}>
                    {shown || <span className="varpeek-empty">{tr('пусто')}</span>}
                  </span>
                  <span className={`varpeek-src s-${row.source}`}>{tr(SOURCE_LABEL[row.source])}</span>
                  {row.secret && (
                    <button
                      className="icon-btn varpeek-act"
                      title={revealed[id] ? tr('Скрыть') : tr('Показать')}
                      onClick={() => setRevealed((r) => ({ ...r, [id]: !r[id] }))}
                    >
                      <Icon name="eye" size={12} />
                    </button>
                  )}
                  <button className="icon-btn varpeek-act" title={tr('Копировать значение')} onClick={() => copy(row)}>
                    <Icon name="copy" size={12} />
                  </button>
                </div>
              )
            })}
            {rows.length === 0 && (
              <div className="varpeek-none">
                {query ? tr('Ничего не найдено') : tr('Переменных пока нет. Создайте окружение в боковой панели или задайте их в коллекции.')}
              </div>
            )}
          </div>

          <div className="varpeek-foot">
            {trf('Приоритет: коллекция → окружение → глобальные. Всего: {n}', { n: rows.length })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
