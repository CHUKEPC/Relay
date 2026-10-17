import { useMemo, useState } from 'react'
import type { TrashEntry } from '@shared/types'
import { Modal } from '@renderer/components/primitives'
import { Icon } from '@renderer/components/Icon'
import { useTrash, TRASH_RETENTION_DAYS } from '@renderer/store/trash'
import { useUi } from '@renderer/store/ui'
import { useI18n, tr, trf } from '@renderer/lib/i18n'
import { emptyTrash, purgeFromTrash, restoreFromTrash, trashKindLabel } from '@renderer/lib/trash'
import '@renderer/styles/feat-trash.css'

function iconOf(e: TrashEntry): string {
  switch (e.kind) {
    case 'node':
      return e.node.type === 'request' ? 'doc' : e.node.type === 'folder' ? 'folder' : 'collections'
    case 'environment':
      return 'env'
    case 'variable':
      return 'key'
    case 'example':
      return 'copy'
    case 'history':
      return 'history'
  }
}

/** Method badge of a deleted request, so it reads like the tree it came from. */
function methodOf(e: TrashEntry): string | null {
  return e.kind === 'node' && e.node.type === 'request' ? e.node.request.method : null
}

function itemCount(e: TrashEntry): number | null {
  if (e.kind === 'history') return e.entries.length
  if (e.kind !== 'node' || e.node.type === 'request') return null
  let n = 0
  const walk = (nodes: typeof e.node.children): void => {
    for (const c of nodes) {
      if (c.type === 'request') n++
      else walk(c.children)
    }
  }
  walk(e.node.children)
  return n
}

/** Deleted items of the current workspace: restore them or delete them for good. */
export function TrashDialog(): JSX.Element {
  const open = useUi((s) => s.trashOpen)
  const entries = useTrash((s) => s.doc.entries)
  const lang = useI18n((s) => s.lang)
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => `${tr(e.name)} ${e.location ?? ''} ${tr(trashKindLabel(e))}`.toLowerCase().includes(q))
  }, [entries, query])

  const when = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    return (t: number) => fmt.format(new Date(t))
  }, [lang])

  const close = (): void => useUi.getState().setTrashOpen(false)

  return (
    <Modal open={open} onOpenChange={(o) => useUi.getState().setTrashOpen(o)} width={620} title={tr('Корзина')}>
      <div className="trash-sub">
        {trf('Удалённые запросы, папки, коллекции, среды, переменные и примеры ответов хранятся {n} дней. Восстановленный элемент возвращается на прежнее место.', { n: TRASH_RETENTION_DAYS })}
      </div>

      {entries.length > 0 && (
        <div className="trash-search">
          <Icon name="search" size={14} />
          <input className="input" value={query} placeholder={tr('Найти в корзине…')} aria-label={tr('Найти в корзине…')} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      <div className="trash-list" role="list">
        {entries.length === 0 && (
          <div className="trash-empty">
            <Icon name="trash" size={22} />
            <span>{tr('Корзина пуста')}</span>
          </div>
        )}
        {entries.length > 0 && shown.length === 0 && <div className="trash-empty small">{tr('Ничего не найдено')}</div>}
        {shown.map((e) => {
          const method = methodOf(e)
          const count = itemCount(e)
          return (
            <div className="trash-row" role="listitem" key={e.id}>
              <span className="trash-ico">
                <Icon name={iconOf(e)} size={15} />
              </span>
              <div className="trash-main">
                <div className="trash-name">
                  {method && <span className={`trash-method m-${method}`}>{method}</span>}
                  <span className="trash-title">{tr(e.name)}</span>
                  {count !== null && <span className="trash-count">{trf('{n} шт.', { n: count })}</span>}
                </div>
                <div className="trash-meta">
                  <span>{tr(trashKindLabel(e))}</span>
                  {e.location && <span className="trash-loc">{tr(e.location)}</span>}
                  <span className="trash-when">{when(e.deletedAt)}</span>
                </div>
              </div>
              <div className="trash-actions">
                <button className="btn ghost" onClick={() => restoreFromTrash(e.id)} title={tr('Вернуть на прежнее место')}>
                  <Icon name="undo" size={14} /> <span className="trash-btn-label">{tr('Восстановить')}</span>
                </button>
                <button
                  className="icon-btn"
                  title={tr('Удалить навсегда')}
                  aria-label={tr('Удалить навсегда')}
                  onClick={() => {
                    if (window.confirm(trf('Удалить «{name}» навсегда? Восстановить его будет нельзя.', { name: tr(e.name) }))) purgeFromTrash(e.id)
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="modal-foot">
        {entries.length > 0 && (
          <button
            className="btn ghost danger trash-empty-btn"
            onClick={() => {
              if (window.confirm(trf('Очистить корзину ({n})? Восстановить удалённое будет нельзя.', { n: entries.length }))) emptyTrash()
            }}
          >
            <Icon name="trash" size={14} /> {tr('Очистить корзину')}
          </button>
        )}
        <button className="btn" onClick={close}>
          {tr('Закрыть')}
        </button>
      </div>
    </Modal>
  )
}
