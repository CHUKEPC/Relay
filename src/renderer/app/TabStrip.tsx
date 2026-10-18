import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { TabGroup, TabModel } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { RequestTag } from '@renderer/components/RequestTag'
import { TAB_GROUP_COLOR_LABEL, TAB_GROUP_COLORS, useTabs } from '@renderer/store/tabs'
import { leavesOf, usePanes } from '@renderer/store/panes'
import { MOD } from '@renderer/lib/platform'
import { dragKind, holdDragOnControls, REQUEST_MIME, TAB_MIME } from '@renderer/lib/dnd'
import { useCollections } from '@renderer/store/collections'
import { saveActiveRequest } from '@renderer/lib/save'
import { exportRequestJson } from '@renderer/lib/export'
import { tr, trf } from '@renderer/lib/i18n'
import '@renderer/styles/feat-tabs.css'

/**
 * A group label being dragged. Its own MIME type, unknown to the pane grid, so
 * a group can only be moved along the strip and never dropped into a pane.
 */
const GROUP_MIME = 'application/x-relay-tab-group'

const NO_GROUPS: TabGroup[] = []

/** CSS custom property carrying a group's colour to its label and its tabs. */
const groupStyle = (g: TabGroup): CSSProperties => ({ '--tg': `var(--tg-${g.color})` }) as CSSProperties

type StripItem = { kind: 'group'; group: TabGroup; count: number } | { kind: 'tab'; tab: TabModel; index: number; group: TabGroup | null; last: boolean }

export function TabStrip() {
  const tabs = useTabs((s) => s.doc.tabs)
  const groups = useTabs((s) => s.doc.groups ?? NO_GROUPS)
  const activeTabId = useTabs((s) => s.doc.activeTabId)
  const setActive = useTabs((s) => s.setActive)
  const closeTab = useTabs((s) => s.closeTab)
  const openNew = useTabs((s) => s.openNew)
  const detached = usePanes((s) => s.detached)
  const paneRoot = usePanes((s) => s.root)
  const shownInPanes = useMemo(() => (paneRoot.kind === 'leaf' ? null : new Set(leavesOf(paneRoot).map((l) => l.tabId))), [paneRoot])

  const scrollerRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<string, HTMLDivElement>())
  const chipRefs = useRef(new Map<string, HTMLDivElement>())
  // The tab (or group) being dragged from this strip. dragover cannot read the
  // payload (the browser hides it until drop), so the strip remembers it itself.
  const draggingRef = useRef<string | null>(null)
  const draggingGroupRef = useRef<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  /** the group whose name/colour editor is open */
  const [editing, setEditing] = useState<string | null>(null)
  /** the group a dragged tab or request would land in (its label lights up) */
  const [dropGroup, setDropGroup] = useState<string | null>(null)

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups])

  // Tabs in reading order, with a label in front of every group; the tabs of
  // a collapsed group are left out.
  const items = useMemo<StripItem[]>(() => {
    const out: StripItem[] = []
    tabs.forEach((tab, index) => {
      const group = tab.groupId ? (groupById.get(tab.groupId) ?? null) : null
      if (group && tabs[index - 1]?.groupId !== group.id) {
        out.push({ kind: 'group', group, count: tabs.filter((t) => t.groupId === group.id).length })
      }
      if (group?.collapsed) return
      out.push({ kind: 'tab', tab, index, group, last: !!group && tabs[index + 1]?.groupId !== group.id })
    })
    return out
  }, [tabs, groupById])

  const endDrag = () => {
    draggingRef.current = null
    draggingGroupRef.current = null
    setDraggingId(null)
    setDropGroup(null)
    document.body.classList.remove('pane-dragging')
  }

  // The dragged tab moves in the DOM while it is reordered; if the browser then
  // skips its dragend, the document-level events still end the drag.
  useEffect(() => {
    const reset = () => (draggingRef.current || draggingGroupRef.current) && endDrag()
    document.addEventListener('dragend', reset, true)
    document.addEventListener('drop', reset)
    return () => {
      document.removeEventListener('dragend', reset, true)
      document.removeEventListener('drop', reset)
    }
  }, [])

  /** Where a tab sits on screen; the tabs of a collapsed group share its label. */
  const rectOf = (t: TabModel): DOMRect | undefined => {
    const g = t.groupId ? groupById.get(t.groupId) : undefined
    return (g?.collapsed ? chipRefs.current.get(g.id) : tabRefs.current.get(t.id))?.getBoundingClientRect()
  }

  /** Slot under the pointer, counted against the midpoints of the other tabs. */
  const slotAt = (clientX: number, skip: (t: TabModel) => boolean): number => {
    let to = 0
    for (const t of useTabs.getState().doc.tabs) {
      if (skip(t)) continue
      const r = rectOf(t)
      if (r && r.left + r.width / 2 < clientX) to++
    }
    return to
  }

  /**
   * The group whose stretch of the strip — its label and its tabs, or just the
   * label when it is folded — lies under the pointer. The edges of a stretch
   * belong to no group: the left half of the label (a quarter on each side of
   * a folded one) and the right third of the last tab. A tab or a request can
   * so land between two neighbour groups, or right after one, without joining.
   */
  const groupUnder = (clientX: number): string | null => {
    const doc = useTabs.getState().doc
    for (const g of doc.groups ?? []) {
      const chip = chipRefs.current.get(g.id)?.getBoundingClientRect()
      if (!chip) continue
      let left = chip.left + chip.width / 2
      let right = chip.right
      if (g.collapsed) {
        left = chip.left + chip.width / 4
        right = chip.right - chip.width / 4
      } else {
        let last: DOMRect | undefined
        for (const t of doc.tabs) {
          if (t.groupId !== g.id) continue
          const r = tabRefs.current.get(t.id)?.getBoundingClientRect()
          if (r && (!last || r.right > last.right)) last = r
        }
        if (last) right = last.right - Math.min(last.width / 3, 48)
      }
      if (clientX >= left && clientX <= right) return g.id
    }
    return null
  }

  /**
   * Reorder like browser tabs: while a tab is dragged over the strip it takes
   * the slot under the pointer. The slot is counted against the midpoints of
   * the other tabs, so a wide tab passing a narrow one does not flip back and
   * forth. A dragged group label moves its whole group the same way.
   *
   * The group follows the pointer too: over a group's label or tabs (a folded
   * group: its label) the dragged tab joins that group, away from every group it
   * leaves its own — except the only tab of a group, which takes the group
   * along. A request dragged from the sidebar opens here, in the group under
   * the pointer if there is one.
   */
  const onStripDragOver = (e: DragEvent<HTMLDivElement>) => {
    const id = draggingRef.current
    const groupId = draggingGroupRef.current
    const isGroup = !!groupId && e.dataTransfer.types.includes(GROUP_MIME)
    if (!isGroup && dragKind(e.dataTransfer) === 'request') {
      e.preventDefault()
      // The tree allows only «move» (like the pane grid); anything else refuses the drop.
      e.dataTransfer.dropEffect = 'move'
      const under = groupUnder(e.clientX)
      if (under !== dropGroup) setDropGroup(under)
      return
    }
    if (!isGroup && (!id || dragKind(e.dataTransfer) !== 'tab')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const scroller = scrollerRef.current
    if (scroller) {
      // Near an end of an overflowing strip, scroll it along.
      const box = scroller.getBoundingClientRect()
      if (e.clientX < box.left + 32) scroller.scrollLeft -= 14
      else if (e.clientX > box.right - 32) scroller.scrollLeft += 14
    }
    if (isGroup) {
      useTabs.getState().moveGroup(groupId, slotAt(e.clientX, (t) => t.groupId === groupId))
      return
    }
    if (!id) return
    const doc = useTabs.getState().doc
    const own = doc.tabs.find((t) => t.id === id)?.groupId ?? null
    let target = groupUnder(e.clientX)
    if (!target && own && !doc.tabs.some((t) => t.id !== id && t.groupId === own)) target = own
    useTabs.getState().moveTab(id, slotAt(e.clientX, (t) => t.id === id), target)
    if (target !== dropGroup) setDropGroup(target)
  }

  /** A saved request dropped on the strip: open it there, in the group under the pointer. */
  const dropRequest = (e: DragEvent<HTMLDivElement>): void => {
    const nodeId = e.dataTransfer.getData(REQUEST_MIME)
    const found = nodeId ? useCollections.getState().locate(nodeId) : null
    const group = groupUnder(e.clientX)
    setDropGroup(null)
    if (!found || found.node.type !== 'request') return
    e.preventDefault()
    const tabId = useTabs.getState().openSaved(found.node.request, found.node.request.id)
    // Right where it was dropped, in or out of the group under the pointer. The
    // strip has not re-rendered yet: the slot is counted on what is on screen,
    // without this tab (an already open one moves here).
    useTabs.getState().moveTab(tabId, slotAt(e.clientX, (t) => t.id === tabId), group)
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

  /** New group for one tab; its editor opens so it can be named right away. */
  const groupTab = (tabId: string): void => {
    const id = useTabs.getState().createGroup([tabId])
    // After the context menu has closed and handed focus back.
    setTimeout(() => setEditing(id), 0)
  }

  const activeGroupId = tabs.find((t) => t.id === activeTabId)?.groupId ?? null

  const renderGroup = (group: TabGroup, count: number) => (
    <PopoverPrimitive.Root key={`g:${group.id}`} open={editing === group.id} onOpenChange={(o) => setEditing(o ? group.id : null)}>
      <PopoverPrimitive.Anchor asChild>
        <div
          className={`tab-group-chip${group.collapsed ? ' collapsed' : ''}${group.name ? '' : ' unnamed'}${draggingId === `g:${group.id}` ? ' dragging' : ''}${dropGroup === group.id ? ' drop-target' : ''}${group.collapsed && activeGroupId === group.id ? ' holds-active' : ''}`}
          style={groupStyle(group)}
          ref={(el) => {
            if (el) chipRefs.current.set(group.id, el)
            else chipRefs.current.delete(group.id)
          }}
          role="button"
          tabIndex={0}
          aria-expanded={!group.collapsed}
          title={
            group.collapsed
              ? trf('{name}: {n} вкл. — нажмите, чтобы развернуть; правый клик — настройки группы', { name: group.name || tr('Группа'), n: count })
              : tr('Нажмите, чтобы свернуть группу; правый клик — название, цвет и действия')
          }
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(GROUP_MIME, group.id)
            e.dataTransfer.effectAllowed = 'move'
            draggingGroupRef.current = group.id
            setDraggingId(`g:${group.id}`)
          }}
          onDragEnd={endDrag}
          onClick={() => useTabs.getState().setGroupCollapsed(group.id, !group.collapsed)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              useTabs.getState().setGroupCollapsed(group.id, !group.collapsed)
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setEditing(group.id)
          }}
        >
          <span className="tg-name">{group.name}</span>
          {group.collapsed && <span className="tg-count">{count}</span>}
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className="popover tg-editor" align="start" sideOffset={6} style={{ position: 'relative' }}>
          <input
            className="input"
            autoFocus
            value={group.name}
            placeholder={tr('Название группы')}
            aria-label={tr('Название группы')}
            onChange={(e) => useTabs.getState().renameGroup(group.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setEditing(null)
            }}
          />
          <div className="tg-colors" role="radiogroup" aria-label={tr('Цвет группы')}>
            {TAB_GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={group.color === c}
                className={`tg-swatch${group.color === c ? ' on' : ''}`}
                style={{ '--tg': `var(--tg-${c})` } as CSSProperties}
                title={tr(TAB_GROUP_COLOR_LABEL[c])}
                aria-label={tr(TAB_GROUP_COLOR_LABEL[c])}
                onClick={() => useTabs.getState().setGroupColor(group.id, c)}
              />
            ))}
          </div>
          <div className="pop-sep" />
          <button
            className="pop-item"
            onClick={() => {
              setEditing(null)
              useTabs.getState().newTabInGroup(group.id)
            }}
          >
            <Icon name="plus" size={14} /> {tr('Новая вкладка в группе')}
          </button>
          <button
            className="pop-item"
            onClick={() => {
              setEditing(null)
              useTabs.getState().setGroupCollapsed(group.id, !group.collapsed)
            }}
          >
            <Icon name={group.collapsed ? 'chevR' : 'chevL'} size={14} /> {group.collapsed ? tr('Развернуть группу') : tr('Свернуть группу')}
          </button>
          <button
            className="pop-item"
            onClick={() => {
              setEditing(null)
              useTabs.getState().ungroup(group.id)
            }}
          >
            <Icon name="tabGroup" size={14} /> {tr('Разгруппировать')}
          </button>
          <button
            className="pop-item danger"
            onClick={() => {
              setEditing(null)
              useTabs.getState().closeGroup(group.id)
            }}
          >
            <Icon name="close" size={14} /> {tr('Закрыть группу')}
          </button>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )

  const renderTab = (t: TabModel, i: number, group: TabGroup | null, last: boolean) => {
    const otherGroups = groups.filter((g) => g.id !== t.groupId)
    return (
      <ContextMenu.Root key={t.id}>
        <ContextMenu.Trigger asChild>
          <div
            className={`rtab${activeTabId === t.id ? ' on' : ''}${t.dirty ? ' is-dirty' : ''}${shownInPanes?.has(t.id) && activeTabId !== t.id ? ' in-pane' : ''}${draggingId === t.id ? ' dragging' : ''}${group ? ' in-group' : ''}${last ? ' group-last' : ''}`}
            style={group ? groupStyle(group) : undefined}
            title={detached.includes(t.id) ? tr('Открыт в отдельном окне — нажмите, чтобы перейти к нему') : undefined}
            ref={(el) => {
              if (el) tabRefs.current.set(t.id, el)
              else tabRefs.current.delete(t.id)
            }}
            draggable
            onPointerDownCapture={holdDragOnControls}
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
          <ContextMenu.Content className="popover" style={{ position: 'relative', minWidth: 200 }}>
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
            {otherGroups.length === 0 ? (
              <ContextMenu.Item className="pop-item" onSelect={() => groupTab(t.id)}>
                <Icon name="tabGroup" size={14} /> {tr('Добавить в новую группу')}
              </ContextMenu.Item>
            ) : (
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className="pop-item">
                  <Icon name="tabGroup" size={14} /> {tr('Добавить в группу')}
                  <Icon name="chevR" size={12} className="pop-sub-chev" />
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className="popover" sideOffset={4} style={{ position: 'relative', minWidth: 190 }}>
                    <ContextMenu.Item className="pop-item" onSelect={() => groupTab(t.id)}>
                      <Icon name="plus" size={14} /> {tr('Новая группа')}
                    </ContextMenu.Item>
                    <ContextMenu.Separator className="pop-sep" />
                    {otherGroups.map((g) => (
                      <ContextMenu.Item key={g.id} className="pop-item" onSelect={() => useTabs.getState().addToGroup(t.id, g.id)}>
                        <span className="tg-dot" style={groupStyle(g)} />
                        <span className="pop-item-text">{g.name || tr('Группа без названия')}</span>
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            )}
            {t.groupId && (
              <ContextMenu.Item className="pop-item" onSelect={() => useTabs.getState().removeFromGroup(t.id)}>
                {tr('Убрать из группы')}
              </ContextMenu.Item>
            )}
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
    )
  }

  return (
    <div className="tabstrip">
      <div
        className="tabstrip-scroll"
        ref={scrollerRef}
        onDragOver={onStripDragOver}
        onDragLeave={(e) => {
          if (!scrollerRef.current?.contains(e.relatedTarget as Node | null)) setDropGroup(null)
        }}
        onDrop={(e) => {
          // Dropped back on the strip: the order is already in place.
          if (draggingRef.current || draggingGroupRef.current) {
            e.preventDefault()
            endDrag()
            return
          }
          if (dragKind(e.dataTransfer) === 'request') dropRequest(e)
        }}
      >
        {items.map((it) => (it.kind === 'group' ? renderGroup(it.group, it.count) : renderTab(it.tab, it.index, it.group, it.last)))}
      </div>
      <button className="icon-btn tabstrip-add" onClick={() => openNew()} title={trf('Новый запрос ({key})', { key: `${MOD}N` })}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}
