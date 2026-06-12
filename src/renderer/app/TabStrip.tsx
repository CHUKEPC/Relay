import { useEffect, useRef } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { Icon } from '@renderer/components/Icon'
import { useTabs } from '@renderer/store/tabs'
import { MOD } from '@renderer/lib/platform'
import { saveActiveRequest } from '@renderer/lib/save'
import { exportRequestJson } from '@renderer/lib/export'
import '@renderer/styles/feat-tabs.css'

export function TabStrip() {
  const tabs = useTabs((s) => s.doc.tabs)
  const activeTabId = useTabs((s) => s.doc.activeTabId)
  const setActive = useTabs((s) => s.setActive)
  const closeTab = useTabs((s) => s.closeTab)
  const openNew = useTabs((s) => s.openNew)

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
                className={`rtab ${activeTabId === t.id ? 'on' : ''}`}
                ref={(el) => {
                  if (el) tabRefs.current.set(t.id, el)
                  else tabRefs.current.delete(t.id)
                }}
                onClick={() => setActive(t.id)}
                onAuxClick={(e) => {
                  // Middle-click closes the tab, like in browsers.
                  if (e.button === 1) {
                    e.preventDefault()
                    closeTab(t.id)
                  }
                }}
              >
                <span className={`method-tag m-${t.request.method}`}>{t.request.method === 'DELETE' ? 'DEL' : t.request.method}</span>
                <span className="label">{t.request.name || 'Без названия'}</span>
                {/* Dirty dot shows when there are unsaved changes; on hover it is
                    replaced by the close X, so every tab is closable with the mouse. */}
                <span className="tab-end">
                  {t.dirty && <span className="dirty" title="Несохранённые изменения" />}
                  <span
                    className="x"
                    title={`Закрыть (${MOD}W)`}
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
                <ContextMenu.Item className="pop-item" onSelect={() => closeTab(t.id)}>
                  Закрыть
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="pop-item"
                  disabled={tabs.length === 1}
                  onSelect={() => useTabs.getState().closeOthers(t.id)}
                >
                  Закрыть другие
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="pop-item"
                  disabled={i === tabs.length - 1}
                  onSelect={() => useTabs.getState().closeToRight(t.id)}
                >
                  Закрыть справа
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="pop-item"
                  disabled={i === 0}
                  onSelect={() => useTabs.getState().closeToLeft(t.id)}
                >
                  Закрыть слева
                </ContextMenu.Item>
                <ContextMenu.Item className="pop-item" onSelect={() => useTabs.getState().closeAll()}>
                  Закрыть все
                </ContextMenu.Item>
                <ContextMenu.Separator className="pop-sep" />
                <ContextMenu.Item className="pop-item" onSelect={() => useTabs.getState().duplicateTab(t.id)}>
                  Дублировать
                </ContextMenu.Item>
                <ContextMenu.Item
                  className="pop-item"
                  onSelect={() => {
                    // saveActiveRequest operates on the active tab — switch first.
                    if (useTabs.getState().doc.activeTabId !== t.id) useTabs.getState().setActive(t.id)
                    saveActiveRequest()
                  }}
                >
                  Сохранить
                </ContextMenu.Item>
                <ContextMenu.Item className="pop-item" onSelect={() => void exportRequestJson(t.request)}>
                  Экспорт
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        ))}
      </div>
      <button className="icon-btn tabstrip-add" onClick={() => openNew()} title={`Новый запрос (${MOD}N)`}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}
