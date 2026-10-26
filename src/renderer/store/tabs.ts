import { create } from 'zustand'
import type { RequestModel, TabGroup, TabGroupColor, TabModel, TabsDoc } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { makeId } from '@shared/id'
import { defaultTabs } from '@shared/defaults'
import { emptyRequest, useCollections } from './collections'
import { useRealtime } from './realtime'
import { useGrpc } from './grpc'
import { useResponse } from './response'
import { persist } from './persist'
import { forgetTab, recordPatch } from './undo-history'
import { useRequestUi } from './request-ui'
import { forgetViews } from '../lib/view-memory'

interface TabsState {
  doc: TabsDoc
  hydrate: (doc: TabsDoc) => void
  activeTab: () => TabModel | null
  activeRequest: () => RequestModel | null
  /** null = the focused pane is empty */
  setActive: (id: string | null) => void
  /**
   * Show a saved request. An open tab of it is reused — the one beside the
   * active tab (same group, or outside groups) first; `fresh` always opens a
   * tab of its own, so a group never takes over a tab that belongs elsewhere.
   */
  openSaved: (request: RequestModel, savedRequestId: string, opts?: { fresh?: boolean }) => string
  openNew: (request?: RequestModel) => string
  closeTab: (id: string) => void
  closeOthers: (id: string) => void
  closeToRight: (id: string) => void
  closeToLeft: (id: string) => void
  closeAll: () => void
  duplicateTab: (id: string) => void
  /**
   * Move a tab so it ends up at `toIndex` (tab strip drag). `groupId` says which
   * group it belongs to afterwards (null = none) — the strip passes the group
   * under the pointer; left out, the neighbours of the new slot decide.
   */
  moveTab: (id: string, toIndex: number, groupId?: string | null) => void
  patchActive: (patch: Partial<RequestModel>) => void
  patchTab: (tabId: string, patch: Partial<RequestModel>) => void
  /** The tab now matches its saved request; other clean tabs of that request take the saved state too. */
  markSaved: (tabId: string, savedRequestId: string) => void
  /** A saved request was renamed in the sidebar: its tabs show the new name. */
  renameSaved: (savedRequestId: string, name: string) => void
  /** Re-read tabs from their saved requests after a bulk edit (find & replace). */
  refreshSaved: (updated: Record<string, RequestModel>) => void

  /* ---- tab groups ---- */
  /** Put the tabs into a new group (gathered where the first of them is); returns its id. */
  createGroup: (tabIds: string[], opts?: { name?: string; color?: TabGroupColor; sourceId?: string }) => string
  /** Move a tab to the end of a group. */
  addToGroup: (tabId: string, groupId: string) => void
  /** Take a tab out of its group; it lands right after the group. */
  removeFromGroup: (tabId: string) => void
  renameGroup: (groupId: string, name: string) => void
  setGroupColor: (groupId: string, color: TabGroupColor) => void
  /** Fold a group to its label (the active tab moves out of it) or unfold it. */
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void
  /** Dissolve the group; its tabs stay where they are. */
  ungroup: (groupId: string) => void
  /** Close every tab of the group. */
  closeGroup: (groupId: string) => void
  /** Open a blank request at the end of the group. */
  newTabInGroup: (groupId: string) => string
  /** Move the whole group so it starts at `toIndex` among the other tabs. */
  moveGroup: (groupId: string, toIndex: number) => void
}

/** Group colours in the order new groups take them. */
export const TAB_GROUP_COLORS: readonly TabGroupColor[] = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey']

/** Colour names for menus and tooltips (Russian source strings, translated on display). */
export const TAB_GROUP_COLOR_LABEL: Record<TabGroupColor, string> = {
  grey: 'Серый',
  blue: 'Синий',
  red: 'Красный',
  yellow: 'Жёлтый',
  green: 'Зелёный',
  pink: 'Розовый',
  purple: 'Фиолетовый',
  cyan: 'Бирюзовый',
  orange: 'Оранжевый'
}

/** The first colour no group uses yet, so neighbouring groups tell apart. */
export function nextGroupColor(groups: readonly TabGroup[]): TabGroupColor {
  const used = new Set(groups.map((g) => g.color))
  return TAB_GROUP_COLORS.find((c) => !used.has(c)) ?? TAB_GROUP_COLORS[groups.length % TAB_GROUP_COLORS.length]
}

/**
 * Keep the groups consistent with the tabs: a tab pointing at an unknown group
 * leaves it, a group without tabs disappears, and the tabs of a group sit next
 * to each other (gathered where its first tab is). Returns the same arrays when
 * nothing changes, so subscribers are not woken for nothing.
 */
export function normalizeGroups(tabs: TabModel[], groups: TabGroup[]): { tabs: TabModel[]; groups: TabGroup[] } {
  const known = new Set(groups.map((g) => g.id))
  let cleaned = tabs
  if (tabs.some((t) => t.groupId && !known.has(t.groupId))) {
    cleaned = tabs.map((t) => (t.groupId && !known.has(t.groupId) ? { ...t, groupId: null } : t))
  }
  const ordered: TabModel[] = []
  const placed = new Set<string>()
  for (const t of cleaned) {
    if (!t.groupId) {
      ordered.push(t)
      continue
    }
    if (placed.has(t.groupId)) continue
    placed.add(t.groupId)
    for (const m of cleaned) if (m.groupId === t.groupId) ordered.push(m)
  }
  const sameOrder = ordered.length === tabs.length && ordered.every((t, i) => t === tabs[i])
  const keptGroups = groups.length === placed.size ? groups : groups.filter((g) => placed.has(g.id))
  return { tabs: sameOrder ? tabs : ordered, groups: keptGroups }
}

/** Index range [first, last] of a group's tabs, or null when it has none. */
export function groupRange(tabs: TabModel[], groupId: string): [number, number] | null {
  const first = tabs.findIndex((t) => t.groupId === groupId)
  if (first === -1) return null
  let last = first
  while (last + 1 < tabs.length && tabs[last + 1].groupId === groupId) last++
  return [first, last]
}

/**
 * Which open tab of a saved request to reuse. A request may be open in several
 * tabs — in two groups, or in a group and outside of it — and the tab nearest
 * to the user wins: the active one, then one in the active tab's group (or
 * outside groups, when the active tab is), then one outside groups, then one in
 * an unfolded group, then any.
 */
export function pickOpenTab(tabs: TabModel[], groups: TabGroup[], savedRequestId: string, activeTabId: string | null): TabModel | null {
  const open = tabs.filter((t) => t.savedRequestId === savedRequestId)
  if (!open.length) return null
  const active = tabs.find((t) => t.id === activeTabId)
  if (active && open.includes(active)) return active
  const context = active?.groupId ?? null
  const folded = new Set(groups.filter((g) => g.collapsed).map((g) => g.id))
  return (
    open.find((t) => (t.groupId ?? null) === context) ??
    open.find((t) => !t.groupId) ??
    open.find((t) => !folded.has(t.groupId!)) ??
    open[0]
  )
}

/**
 * JSON with sorted keys, leaving out what carries nothing — undefined, null,
 * '', [] and {} — so key order, an emptied field or a field that was never set
 * do not count as a change.
 */
function stable(v: unknown): string {
  // Wrapped, so an empty value on its own counts as absent too.
  return JSON.stringify((prune({ v }) as { v?: unknown }).v ?? null)
}

function prune(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(prune)
  if (!v || typeof v !== 'object') return v
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v).sort()) {
    const p = prune((v as Record<string, unknown>)[k])
    if (p === undefined || p === null || p === '' || (Array.isArray(p) && !p.length)) continue
    if (typeof p === 'object' && !Array.isArray(p) && !Object.keys(p as object).length) continue
    out[k] = p
  }
  return out
}

/** True when `a` holds anything `b` does not — what the unsaved-changes dot on a tab means. */
export function requestsDiffer(a: RequestModel, b: RequestModel): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (stable((a as unknown as Record<string, unknown>)[k]) !== stable((b as unknown as Record<string, unknown>)[k])) return true
  }
  return false
}

/**
 * What a blank tab started as, so typing in it and erasing it again leaves it
 * clean. Kept for this session only; saved tabs compare with their request.
 */
const blankBaselines = new Map<string, RequestModel>()

/**
 * Whether a tab holding `request` has unsaved changes: it differs from the
 * saved request it is bound to (or from the blank it started as). Edits taken
 * back by hand or by undo clear the dot again.
 */
function isDirty(tab: TabModel, request: RequestModel): boolean {
  if (tab.savedRequestId) {
    const saved = useCollections.getState().getRequest(tab.savedRequestId)
    return !saved || requestsDiffer(request, saved)
  }
  const blank = blankBaselines.get(tab.id)
  return blank ? requestsDiffer(request, blank) : true
}

type ActiveTabFallback = (remaining: TabModel[], closedIndex: number) => string | null
let activeTabFallback: ActiveTabFallback | null = null

/** Lets the pane layout choose which tab becomes active after the active one closes. */
export function setActiveTabFallback(fn: ActiveTabFallback): void {
  activeTabFallback = fn
}

export const useTabs = create<TabsState>((set, get) => {
  const commit = (next: Partial<TabsDoc>) => {
    const merged = { ...get().doc, ...next }
    const norm = normalizeGroups(merged.tabs, merged.groups ?? [])
    const doc = { ...merged, tabs: norm.tabs, groups: norm.groups, version: STORAGE_VERSION }
    set({ doc })
    persist('tabs', doc)
  }

  const groups = (): TabGroup[] => get().doc.groups ?? []

  /** Unfold the group of a tab that is being shown, so the strip can point at it. */
  const revealed = (tabId: string | null): Partial<TabsDoc> => {
    const tab = tabId ? get().doc.tabs.find((t) => t.id === tabId) : undefined
    const group = tab?.groupId ? groups().find((g) => g.id === tab.groupId) : undefined
    if (!group?.collapsed) return {}
    return { groups: groups().map((g) => (g.id === group.id ? { ...g, collapsed: false } : g)) }
  }

  // Tear down any live WebSocket/SSE connection + drop volatile per-tab state
  // so closing a realtime tab doesn't leak a socket/IPC listener. Must run for
  // EVERY closed tab, including bulk closes (close others/right/left/all).
  const teardownTab = (id: string) => {
    forgetTab(id)
    blankBaselines.delete(id)
    useRequestUi.getState().forgetTab(id)
    forgetViews(id)
    useRealtime.getState().disconnect(id)
    useGrpc.getState().cancel(id)
    useResponse.setState((s) => {
      if (!(id in s.byTab)) return s
      const { [id]: _drop, ...rest } = s.byTab
      return { byTab: rest }
    })
  }

  // Shared bulk-close: tear down every dropped tab, keep the rest, and land the
  // active tab on the anchor when the previously-active tab was closed.
  const closeWhere = (anchorId: string, drop: (t: TabModel, idx: number) => boolean) => {
    const prev = get().doc.tabs
    if (!prev.some((t) => t.id === anchorId)) return
    const kept = prev.filter((t, i) => !drop(t, i))
    if (kept.length === prev.length) return
    prev.forEach((t, i) => {
      if (drop(t, i)) teardownTab(t.id)
    })
    let activeTabId = get().doc.activeTabId
    if (!kept.some((t) => t.id === activeTabId)) activeTabId = anchorId
    commit({ tabs: kept, activeTabId })
  }

  return {
    doc: defaultTabs(),
    hydrate: (doc) => {
      const norm = normalizeGroups(doc.tabs ?? [], doc.groups ?? [])
      set({ doc: { ...doc, tabs: norm.tabs, groups: norm.groups, version: STORAGE_VERSION } })
    },

    activeTab: () => {
      const { tabs, activeTabId } = get().doc
      return tabs.find((t) => t.id === activeTabId) ?? null
    },
    activeRequest: () => get().activeTab()?.request ?? null,

    setActive: (id) => commit({ activeTabId: id, ...revealed(id) }),

    openSaved: (request, savedRequestId, opts = {}) => {
      const { tabs, activeTabId } = get().doc
      const existing = opts.fresh ? null : pickOpenTab(tabs, groups(), savedRequestId, activeTabId)
      if (existing) {
        commit({ activeTabId: existing.id, ...revealed(existing.id) })
        return existing.id
      }
      const tab: TabModel = { id: makeId('tab'), request: structuredClone(request), savedRequestId, dirty: false }
      commit({ tabs: [...get().doc.tabs, tab], activeTabId: tab.id })
      return tab.id
    },

    openNew: (request) => {
      const tab: TabModel = {
        id: makeId('tab'),
        request: request ? structuredClone(request) : emptyRequest(),
        savedRequestId: null,
        dirty: !!request
      }
      if (!request) blankBaselines.set(tab.id, structuredClone(tab.request))
      commit({ tabs: [...get().doc.tabs, tab], activeTabId: tab.id })
      return tab.id
    },

    closeTab: (id) => {
      teardownTab(id)
      const prev = get().doc.tabs
      const idx = prev.findIndex((t) => t.id === id)
      const tabs = prev.filter((t) => t.id !== id)
      let activeTabId = get().doc.activeTabId
      if (activeTabId === id) {
        // Activate the neighbour: the tab that shifts into the closed slot, else
        // the one to its left — not always the last tab.
        activeTabId = activeTabFallback
          ? activeTabFallback(tabs, idx)
          : tabs.length
            ? (tabs[idx] ?? tabs[idx - 1] ?? tabs[tabs.length - 1]).id
            : null
      }
      commit({ tabs, activeTabId })
    },

    closeOthers: (id) => closeWhere(id, (t) => t.id !== id),

    closeToRight: (id) => {
      const idx = get().doc.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return
      closeWhere(id, (_t, i) => i > idx)
    },

    closeToLeft: (id) => {
      const idx = get().doc.tabs.findIndex((t) => t.id === id)
      if (idx <= 0) return
      closeWhere(id, (_t, i) => i < idx)
    },

    closeAll: () => {
      for (const t of get().doc.tabs) teardownTab(t.id)
      commit({ tabs: [], activeTabId: null })
    },

    duplicateTab: (id) => {
      const prev = get().doc.tabs
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return
      const request = structuredClone(prev[idx].request)
      request.id = makeId('req')
      // Regenerate nested ids so the copy doesn't alias the original's items
      // (prefixes match the creators in lib/examples.ts / RealtimePanel.tsx).
      request.examples = request.examples?.map((ex) => ({ ...ex, id: makeId('ex') }))
      request.messageTemplates = request.messageTemplates?.map((t) => ({ ...t, id: makeId('mt') }))
      // The copy is an unsaved draft: not bound to a collection request, dirty.
      // It stays in the original's group, right beside it, and remembers what
      // it was copied from so saving it can offer the original's folder.
      const tab: TabModel = {
        id: makeId('tab'),
        request,
        savedRequestId: null,
        dirty: true,
        groupId: prev[idx].groupId ?? null,
        copyOf: prev[idx].savedRequestId ?? prev[idx].copyOf ?? null
      }
      commit({ tabs: [...prev.slice(0, idx + 1), tab, ...prev.slice(idx + 1)], activeTabId: tab.id })
    },

    moveTab: (id, toIndex, target) => {
      const prev = get().doc.tabs
      const from = prev.findIndex((t) => t.id === id)
      if (from === -1) return
      const to = Math.max(0, Math.min(prev.length - 1, Math.round(toIndex)))
      const tabs = prev.slice()
      const [tab] = tabs.splice(from, 1)
      tabs.splice(to, 0, tab)
      let groupId = tab.groupId ?? null
      if (target !== undefined) {
        // The strip decided from the pointer; an unknown group means none.
        groupId = target && groups().some((g) => g.id === target) ? target : null
      } else {
        // Group membership follows the slot, like browser tab groups: dropped
        // between two tabs of a group, the tab joins it; dragged away from the
        // rest of its group, it leaves. The only tab of a group takes it along.
        const left = tabs[to - 1]
        const right = tabs[to + 1]
        if (left?.groupId && left.groupId === right?.groupId) groupId = left.groupId
        else if (groupId) {
          const others = tabs.some((t) => t.id !== id && t.groupId === groupId)
          const beside = left?.groupId === groupId || right?.groupId === groupId
          if (others && !beside) groupId = null
        }
      }
      const regrouped = groupId !== (tab.groupId ?? null)
      if (to === from && !regrouped) return
      if (regrouped) tabs[to] = { ...tab, groupId }
      // A tab dropped into a folded group is meant to be in it: the group opens.
      const joined = groupId ? groups().find((g) => g.id === groupId) : undefined
      const unfold = regrouped && joined?.collapsed ? { groups: groups().map((g) => (g.id === groupId ? { ...g, collapsed: false } : g)) } : {}
      commit({ tabs, ...unfold })
    },

    patchActive: (patch) => {
      const id = get().doc.activeTabId
      if (id) get().patchTab(id, patch)
    },

    patchTab: (tabId, patch) => {
      const before = get().doc.tabs.find((t) => t.id === tabId)
      if (before) recordPatch(tabId, before.request, patch)
      const tabs = get().doc.tabs.map((t) => {
        if (t.id !== tabId) return t
        const request = { ...t.request, ...patch }
        return { ...t, request, dirty: isDirty(t, request) }
      })
      commit({ tabs })
    },

    markSaved: (tabId, savedRequestId) => {
      const saved = get().doc.tabs.find((t) => t.id === tabId)
      if (!saved) return
      const tabs = get().doc.tabs.map((t) => {
        if (t.id === tabId) {
          const { copyOf: _was, ...rest } = t
          return { ...rest, savedRequestId, dirty: false }
        }
        // The same request open elsewhere (another group) follows the save,
        // unless it holds edits of its own.
        if (t.savedRequestId === savedRequestId && !t.dirty) return { ...t, request: structuredClone(saved.request) }
        return t
      })
      commit({ tabs })
    },

    renameSaved: (savedRequestId, name) => {
      if (!get().doc.tabs.some((t) => t.savedRequestId === savedRequestId)) return
      // The name is the saved request's, not an edit: dirty flags stay as they are.
      const tabs = get().doc.tabs.map((t) => (t.savedRequestId === savedRequestId ? { ...t, request: { ...t.request, name } } : t))
      commit({ tabs })
    },

    refreshSaved: (updated) => {
      let touched = false
      const tabs = get().doc.tabs.map((t) => {
        const saved = t.savedRequestId ? updated[t.savedRequestId] : undefined
        // A tab with unsaved edits keeps them: it is the user's draft, not a copy.
        if (!saved || t.dirty) return t
        touched = true
        return { ...t, request: structuredClone(saved) }
      })
      if (touched) commit({ tabs })
    },

    createGroup: (tabIds, opts = {}) => {
      const ids = new Set(tabIds)
      const id = makeId('tg')
      const group: TabGroup = { id, name: opts.name ?? '', color: opts.color ?? nextGroupColor(groups()), collapsed: false }
      if (opts.sourceId) group.sourceId = opts.sourceId
      const tabs = get().doc.tabs.map((t) => (ids.has(t.id) ? { ...t, groupId: id } : t))
      commit({ tabs, groups: [...groups(), group] })
      return id
    },

    addToGroup: (tabId, groupId) => {
      const prev = get().doc.tabs
      const tab = prev.find((t) => t.id === tabId)
      const group = groups().find((g) => g.id === groupId)
      if (!tab || !group || tab.groupId === groupId) return
      const rest = prev.filter((t) => t.id !== tabId)
      const range = groupRange(rest, groupId)
      rest.splice(range ? range[1] + 1 : rest.length, 0, { ...tab, groupId })
      // The tab is meant to be seen in its new group.
      const unfolded = group.collapsed ? groups().map((g) => (g.id === groupId ? { ...g, collapsed: false } : g)) : groups()
      commit({ tabs: rest, groups: unfolded })
    },

    removeFromGroup: (tabId) => {
      const prev = get().doc.tabs
      const tab = prev.find((t) => t.id === tabId)
      if (!tab?.groupId) return
      const rest = prev.filter((t) => t.id !== tabId)
      const range = groupRange(rest, tab.groupId)
      rest.splice(range ? range[1] + 1 : prev.indexOf(tab), 0, { ...tab, groupId: null })
      commit({ tabs: rest })
    },

    renameGroup: (groupId, name) => {
      commit({ groups: groups().map((g) => (g.id === groupId ? { ...g, name } : g)) })
    },

    setGroupColor: (groupId, color) => {
      commit({ groups: groups().map((g) => (g.id === groupId ? { ...g, color } : g)) })
    },

    setGroupCollapsed: (groupId, collapsed) => {
      const group = groups().find((g) => g.id === groupId)
      if (!group || group.collapsed === collapsed) return
      const next: Partial<TabsDoc> = { groups: groups().map((g) => (g.id === groupId ? { ...g, collapsed } : g)) }
      const { tabs, activeTabId } = get().doc
      const active = tabs.find((t) => t.id === activeTabId)
      if (collapsed && active?.groupId === groupId) {
        // The nearest tab still on view takes over (to the right first, like
        // the browsers). Tabs of other folded groups are skipped: opening one of
        // them would fold this group and unfold the neighbour at one click.
        // With nothing on view the request stays shown and its label says so.
        const range = groupRange(tabs, groupId)
        const folded = new Set(next.groups!.filter((g) => g.collapsed).map((g) => g.id))
        const onView = (t: TabModel) => !t.groupId || !folded.has(t.groupId)
        const after = range ? tabs.slice(range[1] + 1).find(onView) : undefined
        const before = range ? tabs.slice(0, range[0]).reverse().find(onView) : undefined
        const target = after ?? before
        if (target) next.activeTabId = target.id
      }
      commit(next)
    },

    ungroup: (groupId) => {
      const tabs = get().doc.tabs.map((t) => (t.groupId === groupId ? { ...t, groupId: null } : t))
      commit({ tabs, groups: groups().filter((g) => g.id !== groupId) })
    },

    closeGroup: (groupId) => {
      const prev = get().doc.tabs
      const range = groupRange(prev, groupId)
      if (!range) return
      const kept = prev.filter((t) => t.groupId !== groupId)
      for (const t of prev) if (t.groupId === groupId) teardownTab(t.id)
      let activeTabId = get().doc.activeTabId
      if (!kept.some((t) => t.id === activeTabId)) {
        activeTabId = activeTabFallback
          ? activeTabFallback(kept, range[0])
          : kept.length
            ? (kept[range[0]] ?? kept[range[0] - 1] ?? kept[kept.length - 1]).id
            : null
      }
      commit({ tabs: kept, activeTabId, groups: groups().filter((g) => g.id !== groupId) })
    },

    newTabInGroup: (groupId) => {
      const id = get().openNew()
      get().addToGroup(id, groupId)
      return id
    },

    moveGroup: (groupId, toIndex) => {
      const prev = get().doc.tabs
      const members = prev.filter((t) => t.groupId === groupId)
      if (!members.length) return
      const rest = prev.filter((t) => t.groupId !== groupId)
      let to = Math.max(0, Math.min(rest.length, Math.round(toIndex)))
      // Never land inside another group: step past it.
      while (to > 0 && to < rest.length && rest[to - 1].groupId && rest[to - 1].groupId === rest[to].groupId) to++
      const tabs = [...rest.slice(0, to), ...members, ...rest.slice(to)]
      if (tabs.every((t, i) => t === prev[i])) return
      commit({ tabs })
    }
  }
})
