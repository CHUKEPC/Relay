import { useEffect, useMemo } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useCollections } from '@renderer/store/collections'
import { useTreeSelection } from '@renderer/store/tree-selection'
import { allIds, topSelected } from '@renderer/lib/tree-select'
import { requestsUnder } from '@renderer/lib/tab-groups'
import { deleteSelected, exportSelected, openSelected, openSelectedAsGroup, runSelected } from '@renderer/lib/bulk-actions'
import { tr, trf } from '@renderer/lib/i18n'

/** True while a dialog or a menu is open — its own Esc must not also end the selection. */
const overlayOpen = (): boolean => !!document.querySelector('.modal, .settings-overlay, .palette-scrim, [data-radix-popper-content-wrapper]')

/**
 * The bar under the collections tree while rows can be ticked: how much is
 * ticked, select all / none, and what can be done with it all at once.
 */
export function SelectionBar(): JSX.Element {
  const ids = useTreeSelection((s) => s.ids)
  const collections = useCollections((s) => s.doc.collections)
  const nodes = useMemo(() => topSelected(collections, ids), [collections, ids])
  const requests = useMemo(() => requestsUnder(nodes).length, [nodes])
  const sel = useTreeSelection.getState
  const none = nodes.length === 0
  const movable = nodes.some((n) => n.type !== 'collection')

  // Esc ends the selection, like leaving a selection mode anywhere else — but
  // not the Esc that closes a dialog (the runner opened from this bar), a menu
  // or a suggestion list in a field elsewhere. Capture phase, so the dialog is
  // still on screen when this looks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen()) return
      const target = e.target instanceof HTMLElement ? e.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"], .monaco-editor') && !target.closest('.sidebar')) return
      useTreeSelection.getState().setActive(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const act = (icon: string, label: string, run: () => void, disabled = none, danger = false) => (
    <button className={`icon-btn tsb-act${danger ? ' danger' : ''}`} title={label} aria-label={label} disabled={disabled} onClick={run}>
      <Icon name={icon} size={15} />
    </button>
  )

  return (
    <div className="tree-selbar" role="toolbar" aria-label={tr('Действия с выбранным')}>
      <div className="tsb-head">
        <span className="tsb-count" title={requests ? trf('Запросов в выбранном: {n}', { n: requests }) : undefined}>
          {none ? tr('Отметьте элементы') : trf('Выбрано: {n}', { n: nodes.length })}
          {requests > 0 && <span className="tsb-sub"> · {trf('запросов: {n}', { n: requests })}</span>}
        </span>
        <button className="link-btn" onClick={() => sel().setIds(allIds(collections))} disabled={!collections.length}>
          {tr('Все')}
        </button>
        {!none && (
          <button className="link-btn" onClick={() => sel().clear()}>
            {tr('Снять')}
          </button>
        )}
        <button className="icon-btn tsb-done" title={tr('Готово (Esc)')} aria-label={tr('Готово (Esc)')} onClick={() => sel().setActive(false)}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="tsb-actions">
        {act('arrowR', tr('Открыть во вкладках'), () => openSelected(nodes), !requests)}
        {act('tabGroup', tr('Открыть группой вкладок'), () => openSelectedAsGroup(nodes), !requests)}
        {act('copy', tr('Дублировать…'), () => sel().openDialog('duplicate', nodes.map((n) => n.id)))}
        {act('folderMove', tr('Переместить…'), () => sel().openDialog('move', nodes.map((n) => n.id)), !movable)}
        {act('upload', tr('Экспорт'), () => exportSelected(nodes))}
        {act('play', tr('Запустить в раннере'), () => runSelected(nodes), !requests)}
        {act('trash', tr('Удалить'), () => deleteSelected(nodes), none, true)}
      </div>
    </div>
  )
}
