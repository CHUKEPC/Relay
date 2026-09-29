import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { Icon } from '@renderer/components/Icon'
import { RequestTag } from '@renderer/components/RequestTag'
import { useTabs } from '@renderer/store/tabs'
import { leavesOf, usePanes } from '@renderer/store/panes'
import { MOD } from '@renderer/lib/platform'
import { dragKind, TAB_MIME } from '@renderer/lib/dnd'
import { saveActiveRequest } from '@renderer/lib/save'
import { exportRequestJson } from '@renderer/lib/export'
import { tr, trf } from '@renderer/lib/i18n'
import '@renderer/styles/feat-tabs.css'

export function TabStrip() {
  const tabs = useTabs((s) => s.doc.tabs)
  const activeTabId = useTabs((s) => s.doc.activeTabId)
  const setActive = useTabs((s) => s.setActive)
  const closeTab = useTabs((s) => s.closeTab)
  const openNew = useTabs((s) => s.openNew)
  const detached = usePanes((s) => s.detached)
  const paneRoot = usePanes((s) => s.root)
  const shownInPanes = useMemo(() => (paneRoot.kind === 'leaf' ? null : new Set(leavesOf(paneRoot).map((l) => l.tabId))), [paneRoot])

  const scrollerRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<string, HTMLDivElement>())
  // The tab being dragged from this strip. dragover cannot read the payload
  // (the browser hides it until drop), so the strip remembers it itself.
  const draggingRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const endDrag = () => {
    draggingRef.current = null
    setDraggingId(null)
    document.body.classList.remove('pane-dragging')
  }

  // The dragged tab moves in the DOM while it is reordered; if the browser then
  // skips its dragend, the document-level events still end the drag.
  useEffect(() => {
    const reset = () => draggingRef.current && endDrag()
    document.addEventListener('dragend', reset, true)
    document.addEventListener('drop', reset)
    return () => {
      document.removeEventListener('dragend', reset, true)
      document.removeEventListener('drop', reset)
    }
  }, [])

  /**
   * Reorder like browser tabs: while a tab is dragged over the strip it takes
   * the slot under the pointer. The slot is counted against the midpoints of
   * the other tabs, so a wide tab passing a narrow one does not flip back and
   * forth.
   */
  const onStripDragOver = (e: DragEvent<HTMLDivElement>) => {
    const id = draggingRef.current
    if (!id || dragKind(e.dataTransfer) !== 'tab') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const scroller = scrollerRef.current
    if (scroller) {
      // Near an end of an overflowing strip, scroll it along.
      const box = scroller.getBoundingClientRect()
      if (e.clientX < box.left + 32) scroller.scrollLeft -= 14
      else if (e.clientX > box.right - 32) scroller.scrollLeft += 14
    }
    let to = 0
    for (const t of useTabs.getState().doc.tabs) {
      if (t.id === id) continue
      const r = tabRefs.current.get(t.id)?.getBoundingClientRect()
      if (r && r.left + r.width / 2 < e.clientX) to++
    }
    useTabs.getState().moveTab(id, to)
  }

  // Vertical wheel scrolls the strip horizontally. Native listener with
  // passive:false — React's synthetic onWheel can't preventDefault reliably.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY
        e.preventDefault()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Keep the active tab visible when it changes (e.g. opened from the sidebar).
  useEffect(() => {
    if (!activeTabId) return
    tabRefs.current.get(activeTabId)?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeTabId])

  return (
    <div className="tabstrip">
      <div
        className="tabstrip-scroll"
        ref={scrollerRef}
        onDragOver={onStripDragOver}
        onDrop={(e) => {
          // Dropped back on the strip: the order is already in place.
          if (draggingRef.current) {
            e.preventDefault()
            endDrag()
          }
        }}
      >
        {tabs.map((t, i) => (
          <ContextMenu.Root key={t.id}>
            <ContextMenu.Trigger asChild>
              <div
                className={`rtab${activeTabId === t.id ? ' on' : ''}${t.dirty ? ' is-dirty' : ''}${shownInPanes?.has(t.id) && activeTabId !== t.id ? ' in-pane' : ''}${draggingId === t.id ? ' dragging' : ''}`}
                title={detached.includes(t.id) ? tr('Открыт в отдельном окне — нажмите, чтобы перейти к нему') : undefined}
                ref={(el) => {
                  if (el) tabRefs.current.set(t.id, el)
                  else tabRefs.current.delete(t.id)
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TAB_MIME, t.id)
                  e.dataTransfer.effectAllowed = 'move'
                  draggingRef.current = t.id
                  setDraggingId(t.id)
                  document.body.classList.add('pane-dragging')
                }}
                onDragEnd={endDrag}
                onClick={() => setActive(t.id)}
                onAuxClick={(e) => {
                  // Middle-click closes the tab, like in browsers.
                  if (e.button === 1) {
                    e.preventDefault()
                    closeTab(t.id)
                  }
                }}
              >
                <RequestTag request={t.request} />
                <span className="label">{tr(t.request.name || 'Без названия')}</span>
                {detached.includes(t.id) && <Icon name="floatWin" size={12} className="tab-window" />}
                {/* Dirty dot shows when there are unsaved changes; on hover it is
                    replaced by the close X, so every tab is closable with the mouse. */}
                <span className="tab-end">
                  {t.dirty && <span className="dirty" title={tr('Несохранённые изменения')} />}
                  <span
                    className="x"
                    title={trf('Закрыть ({key})', { key: `${MOD}W` })}
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(t.id)
                    }}
                  >
                    <Icon name="close" size={12} />
                  </span>
                </span>
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="popover" style={{ position: 'relative', minWidth: 180 }}>
                <ContextMenu.Item className="pop-item" onSelect={() => closeTab(t.id)}> {tr('Закрыть')} </ContextMenu.Item>
                <ContextMenu.Item
                  className="pop-item"
                  disabled={tabs.length === 1}
                  onSelect={() => useTabs.getState().closeOthers(t.id)}
                > {tr('Закрыть другие')} </ContextMenu.Item>
                <ContextMenu.Item
                  className="pop-item"
                  disabled={i === tabs.length - 1}
                  onSelect={() => useTabs.getState().closeToRight(t.id)}
                > {tr('Закрыть справа')} </ContextMenu.Item>
                <ContextMenu.Item
                  className="pop-item"
                  disabled={i === 0}
                  onSelect={() => useTabs.getState().closeToLeft(t.id)}
                > {tr('Закрыть слева')} </ContextMenu.Item>
                <ContextMenu.Item className="pop-item" onSelect={() => useTabs.getState().closeAll()}> {tr('Закрыть все')} </ContextMenu.Item>
                <ContextMenu.Separator className="pop-sep" />
                <ContextMenu.Item className="pop-item" onSelect={() => void usePanes.getState().detachTab(t.id)}>
                  {detached.includes(t.id) ? tr('Перейти к окну') : tr('Открыть в отдельном окне')}
                </ContextMenu.Item>
                <ContextMenu.Item className="pop-item" onSelect={() => useTabs.getState().duplicateTab(t.id)}> {tr('Дублировать')} </ContextMenu.Item>
                <ContextMenu.Item
                  className="pop-item"
                  onSelect={() => saveActiveRequest(t.id)}
                > {tr('Сохранить')} </ContextMenu.Item>
                <ContextMenu.Item className="pop-item" onSelect={() => void exportRequestJson(t.request)}> {tr('Экспорт')} </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        ))}
      </div>
      <button className="icon-btn tabstrip-add" onClick={() => openNew()} title={trf('Новый запрос ({key})', { key: `${MOD}N` })}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}
