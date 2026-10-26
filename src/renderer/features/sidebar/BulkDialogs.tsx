import { useEffect, useMemo, useState } from 'react'
import type { CollectionNode } from '@shared/types'
import { Modal } from '@renderer/components/primitives'
import { copyName, useCollections } from '@renderer/store/collections'
import { useTreeSelection } from '@renderer/store/tree-selection'
import { useUi } from '@renderer/store/ui'
import { folderTargets, parentIdOf } from '@renderer/lib/copy-target'
import { topSelected } from '@renderer/lib/tree-select'
import { FolderSelect, NameChoice, type NameMode } from '@renderer/features/collections/NameChoice'
import { tr, trf } from '@renderer/lib/i18n'

/** «Next to the original(s)» in the target list. */
const SAME = '__same'

const nameOf = (n: CollectionNode): string => (n.type === 'request' ? n.request.name : n.name)

/** The nodes a dialog was opened for, read fresh from the tree. */
function useDialogNodes(kind: 'duplicate' | 'move'): CollectionNode[] {
  const dialog = useTreeSelection((s) => s.dialog)
  const collections = useCollections((s) => s.doc.collections)
  return useMemo(() => (dialog?.kind === kind ? topSelected(collections, dialog.ids) : []), [dialog, kind, collections])
}

/**
 * Duplicate from the sidebar. One node: «Name (копия)» or one's own name, and
 * where the copy goes (by default right after the original). Several: each
 * copy is named «… (копия)», next to its original or all into one folder. A
 * collection's copy always sits at the top level, after the original.
 */
export function DuplicateDialog(): JSX.Element {
  const open = useTreeSelection((s) => s.dialog?.kind === 'duplicate')
  const close = useTreeSelection((s) => s.closeDialog)
  const nodes = useDialogNodes('duplicate')
  const collections = useCollections((s) => s.doc.collections)
  const single = nodes.length === 1 ? nodes[0] : null
  const onlyCollections = nodes.length > 0 && nodes.every((n) => n.type === 'collection')

  const [mode, setMode] = useState<NameMode>('copy')
  const [own, setOwn] = useState('')
  const [target, setTarget] = useState(SAME)

  const excluded = useMemo(() => nodes.filter((n) => n.type !== 'request').map((n) => n.id), [nodes])
  const targets = useMemo(() => folderTargets(collections, excluded), [collections, excluded])
  const suggested = single ? copyName(tr(nameOf(single))) : ''

  useEffect(() => {
    if (!open) return
    setMode('copy')
    setOwn('')
    const parent = single && single.type !== 'collection' ? parentIdOf(useCollections.getState().doc.collections, single.id) : null
    setTarget(parent ?? SAME)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const confirm = (): void => {
    const store = useCollections.getState()
    let made = 0
    for (const n of nodes) {
      const parentId = n.type === 'collection' || target === SAME ? undefined : target
      const name = single ? (mode === 'own' && own.trim()) || suggested : undefined
      if (store.duplicateNode(n.id, { name, parentId })) made++
    }
    close()
    if (made) useUi.getState().showToast(made === 1 ? tr('Копия создана') : trf('Создано копий: {n}', { n: made }))
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && close()} title={single ? tr('Дублировать') : trf('Дублировать выбранное ({n})', { n: nodes.length })} width={460}>
      {single ? (
        <div className="field">
          <label>{tr('Название копии')}</label>
          <NameChoice suggested={suggested} mode={mode} onMode={setMode} own={own} onOwn={setOwn} onEnter={confirm} />
        </div>
      ) : (
        <div className="field">
          <div className="hint" style={{ marginTop: 0 }}>{tr('Каждая копия получит название «… (копия)».')}</div>
        </div>
      )}
      {onlyCollections ? (
        <div className="field">
          <div className="hint" style={{ marginTop: 0 }}>{tr('Копия коллекции появится в списке сразу после оригинала.')}</div>
        </div>
      ) : (
        <div className="field">
          <label>{tr('Куда поместить')}</label>
          <FolderSelect targets={targets} value={target} onChange={setTarget} extra={single ? [] : [{ id: SAME, label: tr('Рядом с оригиналами') }]} />
          <div className="hint">
            {single
              ? tr('По умолчанию — рядом с оригиналом.')
              : nodes.some((n) => n.type === 'collection')
                ? tr('Коллекции копируются на верхний уровень, рядом с оригиналами.')
                : tr('По умолчанию — каждая копия рядом со своим оригиналом.')}
          </div>
        </div>
      )}
      <div className="modal-foot">
        <button className="btn" onClick={close}> {tr('Отмена')} </button>
        <button className="btn primary" disabled={!nodes.length} onClick={confirm}> {tr('Дублировать')} </button>
      </div>
    </Modal>
  )
}

/**
 * Move from the sidebar: requests and folders go to the end of the folder or
 * collection picked here. Collections stay at the top level (their order is
 * changed by dragging).
 */
export function MoveDialog(): JSX.Element {
  const open = useTreeSelection((s) => s.dialog?.kind === 'move')
  const close = useTreeSelection((s) => s.closeDialog)
  const nodes = useDialogNodes('move')
  const collections = useCollections((s) => s.doc.collections)
  const movable = useMemo(() => nodes.filter((n) => n.type !== 'collection'), [nodes])
  const excluded = useMemo(() => movable.filter((n) => n.type === 'folder').map((n) => n.id), [movable])
  const targets = useMemo(() => folderTargets(collections, excluded), [collections, excluded])
  const [target, setTarget] = useState('')

  useEffect(() => {
    if (!open) return
    const roots = useCollections.getState().doc.collections
    const here = movable.length ? parentIdOf(roots, movable[0].id) : null
    // Somewhere else than where the first item already is.
    setTarget(targets.find((t) => t.id !== here)?.id ?? targets[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    setTarget((cur) => (cur && targets.some((t) => t.id === cur) ? cur : targets[0]?.id ?? ''))
  }, [targets])

  const confirm = (): void => {
    if (!target || !movable.length) return
    const moved = useCollections.getState().moveNodes(
      movable.map((n) => n.id),
      target
    )
    close()
    useUi.getState().showToast(moved ? trf('Перемещено: {n}', { n: moved }) : tr('Нечего перемещать'), moved ? 'ok' : 'error')
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && close()} title={nodes.length === 1 ? tr('Переместить') : trf('Переместить выбранное ({n})', { n: nodes.length })} width={460}>
      <div className="field">
        <label>{tr('Куда переместить')}</label>
        {targets.length ? <FolderSelect targets={targets} value={target} onChange={setTarget} /> : <div className="hint">{tr('Некуда перемещать — создайте коллекцию или папку.')}</div>}
        <div className="hint">
          {movable.length < nodes.length
            ? tr('Коллекции остаются на верхнем уровне — их порядок меняется перетаскиванием.')
            : tr('Элементы окажутся в конце выбранной папки.')}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={close}> {tr('Отмена')} </button>
        <button className="btn primary" disabled={!movable.length || !target} onClick={confirm}> {tr('Переместить')} </button>
      </div>
    </Modal>
  )
}
