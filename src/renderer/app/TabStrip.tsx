import { useEffect, useMemo, useRef } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { Icon } from '@renderer/components/Icon'
import { RequestTag } from '@renderer/components/RequestTag'
import { useTabs } from '@renderer/store/tabs'
import { leavesOf, usePanes } from '@renderer/store/panes'
import { MOD } from '@renderer/lib/platform'
import { TAB_MIME } from '@renderer/lib/dnd'
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
      <div className="tabstrip-scroll" ref={scrollerRef}>
        {tabs.map((t, i) => (
          <ContextMenu.Root key={t.id}>
            <ContextMenu.Trigger asChild>
              <div
                className={`rtab${activeTabId === t.id ? ' on' : ''}${t.dirty ? ' is-dirty' : ''}${shownInPanes?.has(t.id) && activeTabId !== t.id ? ' in-pane' : ''}`}
                title={detached.includes(t.id) ? tr('Открыт в отдельном окне — нажмите, чтобы перейти к нему') : undefined}
                ref={(el) => {
                  if (el) tabRefs.current.set(t.id, el)
                  else tabRefs.current.delete(t.id)
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TAB_MIME, t.id)
                  e.dataTransfer.effectAllowed = 'move'
                  document.body.classList.add('pane-dragging')
                }}
                onDragEnd={() => document.body.classList.remove('pane-dragging')}
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
