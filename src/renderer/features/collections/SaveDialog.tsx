import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@renderer/components/primitives'
import { copyName, useCollections } from '@renderer/store/collections'
import { useTabs } from '@renderer/store/tabs'
import { folderTargets, saveDefaults, type SaveDefaults } from '@renderer/lib/copy-target'
import { FolderSelect, NameChoice, type NameMode } from './NameChoice'

import { tr } from '@renderer/lib/i18n'

/**
 * Save the active tab as a request in a collection. A duplicated tab is saved
 * as a copy: the dialog offers «Name (копия)» or one's own name, and the folder
 * of the request it was copied from. Save As on a saved request offers its own
 * folder.
 */
export function SaveDialog({
  open,
  onOpenChange,
  onSave
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSave: (parentId: string, name: string) => void
}) {
  const collections = useCollections((s) => s.doc.collections)
  const addCollection = useCollections((s) => s.addCollection)
  const targets = useMemo(() => folderTargets(collections), [collections])

  const [defaults, setDefaults] = useState<SaveDefaults>({ copy: false, suggested: '', parentId: null })
  const [name, setName] = useState('')
  const [mode, setMode] = useState<NameMode>('copy')
  const [own, setOwn] = useState('')
  const [parentId, setParentId] = useState('')

  // Start over every time the dialog opens, from the tab it saves.
  useEffect(() => {
    if (!open) return
    const tab = useTabs.getState().activeTab()
    const d = saveDefaults(tab, useCollections.getState().doc.collections, tr(tab?.request.name || 'Без названия'), copyName)
    setDefaults(d)
    setName(d.suggested)
    setMode('copy')
    setOwn('')
    setParentId(d.parentId ?? '')
  }, [open])

  // Keep the selected parent valid — re-seed if it no longer exists (e.g. the
  // folder was deleted while the dialog was open), so confirm() can't save
  // into a non-existent parent.
  useEffect(() => {
    setParentId((cur) => (cur && targets.some((t) => t.id === cur) ? cur : targets[0]?.id ?? ''))
  }, [open, targets])

  const confirm = () => {
    let target = parentId
    if (!target) target = addCollection(tr('Моя коллекция'))
    const final = defaults.copy ? (mode === 'own' && own.trim()) || defaults.suggested : name.trim() || tr('Без названия')
    onSave(target, final)
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={defaults.copy ? tr('Сохранить копию запроса') : tr('Сохранить запрос')} width={460}>
      {defaults.copy ? (
        <div className="field">
          <label>{tr('Название')}</label>
          <NameChoice suggested={defaults.suggested} mode={mode} onMode={setMode} own={own} onOwn={setOwn} onEnter={confirm} />
        </div>
      ) : (
        <div className="field">
          <label>{tr('Название')}</label>
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirm()} />
        </div>
      )}
      <div className="field">
        <label>{tr('Куда сохранить')}</label>
        {targets.length ? (
          <FolderSelect targets={targets} value={parentId} onChange={setParentId} />
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--tx-2)' }}>{tr('Коллекций нет — будет создана новая «Моя коллекция».')}</div>
        )}
        {defaults.copy && defaults.parentId && parentId === defaults.parentId && (
          <div className="hint">{tr('По умолчанию — рядом с исходным запросом.')}</div>
        )}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => onOpenChange(false)}> {tr('Отмена')} </button>
        <button className="btn primary" onClick={confirm}> {tr('Сохранить')} </button>
      </div>
    </Modal>
  )
}
