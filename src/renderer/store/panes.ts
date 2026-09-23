import { create } from 'zustand'
import type { TabModel } from '@shared/types'
import { makeId } from '@shared/id'
import { clamp } from '@renderer/lib/math'
import { setActiveTabFallback, useTabs } from './tabs'
import { useResponse, type TabResponse } from './response'
import { useUi } from './ui'
import type { DockMode, FloatRect } from '@renderer/lib/dock'

import { tr, trf } from '@renderer/lib/i18n'
/* ============================================================
 * Model — a Terminator-style binary split tree
 * ============================================================ */

/** `row` places children side by side, `col` stacks them. */
export type SplitDir = 'row' | 'col'
export type Direction = 'left' | 'right' | 'up' | 'down'
/** Builder/response arrangement inside one pane (the 1.2 field, still read). */
export type PaneLayout = 'split-v' | 'split-h'
export type DropZone = 'center' | Direction

export interface PaneLeaf {
  kind: 'leaf'
  id: string
  tabId: string | null
  /** response share of the pane, percent */
  respPct: number
  layout: PaneLayout
  /**
   * Where the response sits inside the pane. 'bottom' and 'right' are what
   * `layout` used to express; 'left' mirrors 'right', and 'float' lifts the
   * response into a movable card over the builder.
   */
  respDock: DockMode
  /** Float geometry, relative to the pane box (px). */
  respFloat: FloatRect
}

export interface PaneSplit {
  kind: 'split'
  id: string
  dir: SplitDir
  /** share of `a`, 0..1 */
  ratio: number
  a: PaneNode
  b: PaneNode
}

export type PaneNode = PaneLeaf | PaneSplit

export const PANE_PRESETS = [1, 2, 3, 4, 8] as const

/**
 * Menu label per preset. Spelled out rather than built from a number because
 * the plural form differs per language (Russian has three of them).
 */
export const PANE_COUNT_LABEL: Record<number, string> = {
  1: '1 панель',
  2: '2 панели',
  3: '3 панели',
  4: '4 панели',
  8: '8 панелей'
}
export type PanePreset = (typeof PANE_PRESETS)[number]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Hard ceiling of the layout engine. */
const MAX_PANES = 16
/**
 * What the base app offers without plugins: one to four panes. The «Дополнительные
 * панели» plugin raises this to {@link MAX_PANES}.
 */
export const CORE_MAX_PANES = 4
const RATIO_STEP = 0.05
const RATIO_MIN = 0.1
const LAYOUT_KEY = 'relay.panes.v1'

export function newLeaf(tabId: string | null = null): PaneLeaf {
  return { kind: 'leaf', id: makeId('pane'), tabId, respPct: 46, layout: 'split-v', respDock: 'bottom', respFloat: { x: 40, y: 60, w: 560, h: 360 } }
}

function split(dir: SplitDir, a: PaneNode, b: PaneNode, ratio = 0.5): PaneSplit {
  return { kind: 'split', id: makeId('split'), dir, ratio, a, b }
}

export function leavesOf(node: PaneNode): PaneLeaf[] {
  return node.kind === 'leaf' ? [node] : [...leavesOf(node.a), ...leavesOf(node.b)]
}

function findLeaf(node: PaneNode, id: string): PaneLeaf | null {
  return leavesOf(node).find((l) => l.id === id) ?? null
}

/** Replace the node with `id` (leaf or split) by `next`. */
function replaceNode(node: PaneNode, id: string, next: PaneNode): PaneNode {
  if (node.id === id) return next
  if (node.kind === 'leaf') return node
  const a = replaceNode(node.a, id, next)
  const b = replaceNode(node.b, id, next)
  return a === node.a && b === node.b ? node : { ...node, a, b }
}

function updateLeaf(node: PaneNode, id: string, patch: Partial<PaneLeaf>): PaneNode {
  const leaf = findLeaf(node, id)
  return leaf ? replaceNode(node, id, { ...leaf, ...patch }) : node
}

/** Splits containing `id`, nearest first, with the side the target sits on. */
function ancestorsOf(node: PaneNode, id: string): { split: PaneSplit; side: 'a' | 'b' }[] {
  if (node.kind === 'leaf') return []
  for (const side of ['a', 'b'] as const) {
    const child = node[side]
    if (child.id === id) return [{ split: node, side }]
    const deeper = ancestorsOf(child, id)
    if (deeper.length) return [...deeper, { split: node, side }]
  }
  return []
}

/** Remove a leaf; its sibling takes the parent's place. Null when it is the root. */
function removeLeaf(root: PaneNode, id: string): PaneNode | null {
  const [parent] = ancestorsOf(root, id)
  if (!parent) return null
  const sibling = parent.side === 'a' ? parent.split.b : parent.split.a
  return replaceNode(root, parent.split.id, sibling)
}

export function layoutRects(node: PaneNode, rect: Rect = { x: 0, y: 0, w: 1, h: 1 }, out = new Map<string, Rect>()): Map<string, Rect> {
  if (node.kind === 'leaf') {
    out.set(node.id, rect)
    return out
  }
  if (node.dir === 'row') {
    const wa = rect.w * node.ratio
    layoutRects(node.a, { x: rect.x, y: rect.y, w: wa, h: rect.h }, out)
    layoutRects(node.b, { x: rect.x + wa, y: rect.y, w: rect.w - wa, h: rect.h }, out)
  } else {
    const ha = rect.h * node.ratio
    layoutRects(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ha }, out)
    layoutRects(node.b, { x: rect.x, y: rect.y + ha, w: rect.w, h: rect.h - ha }, out)
  }
  return out
}

/** The pane touching `id`'s edge in `dir` with the largest shared border. */
function neighborOf(root: PaneNode, id: string, dir: Direction): PaneLeaf | null {
  const rects = layoutRects(root)
  const r = rects.get(id)
  if (!r) return null
  const eps = 1e-6
  let best: { leaf: PaneLeaf; overlap: number } | null = null
  for (const leaf of leavesOf(root)) {
    if (leaf.id === id) continue
    const c = rects.get(leaf.id)!
    let touches = false
    let overlap = 0
    if (dir === 'left' || dir === 'right') {
      touches = dir === 'left' ? Math.abs(c.x + c.w - r.x) < eps : Math.abs(r.x + r.w - c.x) < eps
      overlap = Math.min(r.y + r.h, c.y + c.h) - Math.max(r.y, c.y)
    } else {
      touches = dir === 'up' ? Math.abs(c.y + c.h - r.y) < eps : Math.abs(r.y + r.h - c.y) < eps
      overlap = Math.min(r.x + r.w, c.x + c.w) - Math.max(r.x, c.x)
    }
    if (touches && overlap > eps && (!best || overlap > best.overlap)) best = { leaf, overlap }
  }
  return best?.leaf ?? null
}

/**
 * Preset layouts, built so that every horizontal divider belongs to one column
 * only. Stacking rows (`col(row(a,b), row(c,d))`) would give the grid a single
 * full-width divider that resizes both columns at once; splitting columns first
 * (`row(col(a,c), col(b,d))`) lets each column be resized on its own, the way
 * the sidebar and the response divider behave.
 *
 * `leaves` are laid out in reading order — leaves[0] top-left, then left to
 * right, then down — which is also the order the pane numbers follow.
 */
function presetTree(n: PanePreset, leaves: PaneLeaf[]): PaneNode {
  const [a, b, c, d, e, f, g, h] = leaves
  switch (n) {
    case 1:
      return a
    case 2:
      return split('row', a, b)
    case 3:
      return split('row', a, split('col', b, c))
    case 4:
      return split('row', split('col', a, c), split('col', b, d))
    case 8:
      return split('row', split('row', split('col', a, e), split('col', b, f)), split('row', split('col', c, g), split('col', d, h)))
  }
}

/**
 * Leaves in reading order (top row left to right, then the next row down).
 * Pane numbers come from here rather than from the tree walk, so the label a
 * user sees matches where the pane actually sits, whatever shape the tree has.
 */
export function leavesInReadingOrder(root: PaneNode): PaneLeaf[] {
  const rects = layoutRects(root)
  const eps = 0.001
  return leavesOf(root).sort((x, y) => {
    const rx = rects.get(x.id)!
    const ry = rects.get(y.id)!
    if (Math.abs(rx.y - ry.y) > eps) return rx.y - ry.y
    return rx.x - ry.x
  })
}

/* ============================================================
 * Store
 * ============================================================ */

interface PanesState {
  root: PaneNode
  activeId: string
  maximizedId: string | null
  /** tabs shown in their own OS windows */
  detached: string[]
  /** a detached pane window holds exactly one fixed pane */
  windowMode: 'main' | 'detached'
  /** how many panes the current feature set allows (raised by a plugin) */
  maxPanes: number

  setMaxPanes: (n: number) => void
  focusPane: (id: string) => void
  focusDirection: (dir: Direction) => void
  setLeafTab: (paneId: string, tabId: string | null) => void
  applyPreset: (n: PanePreset) => void
  splitActive: (dir: SplitDir) => void
  closePane: (id?: string) => void
  swapLeaves: (aId: string, bId: string) => void
  moveActive: (dir: Direction) => void
  movePaneTo: (sourceId: string, targetId: string, zone: DropZone) => void
  /** drop an open tab into a pane: `center` replaces its content, an edge splits it */
  dropTabInto: (tabId: string, targetPaneId: string, zone: DropZone) => void
  /** drop an open tab against an outer edge of the whole grid */
  dropTabAtEdge: (tabId: string, side: Direction) => void
  flipActiveGroup: () => void
  resizeActive: (dir: Direction) => void
  setRatio: (splitId: string, ratio: number) => void
  setRespPct: (paneId: string, pct: number) => void
  toggleLeafLayout: (paneId: string) => void
  setRespDock: (paneId: string, dock: DockMode) => void
  setRespFloat: (paneId: string, rect: FloatRect) => void
  toggleMaximize: (id?: string) => void
  detachTab: (tabId: string) => Promise<void>
  initDetached: (tabId: string) => void
}

const initialLeaf = newLeaf()

/** Tabs not shown in any pane (optionally ignoring one pane) nor in a separate window. */
export function freeTabs(state: Pick<PanesState, 'root' | 'detached'>, ignorePaneId?: string): TabModel[] {
  const used = new Set(
    leavesOf(state.root)
      .filter((l) => l.id !== ignorePaneId && l.tabId)
      .map((l) => l.tabId as string)
  )
  return useTabs.getState().doc.tabs.filter((t) => !used.has(t.id) && !state.detached.includes(t.id))
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Room for one more pane under the current feature set? */
function canGrow(s: Pick<PanesState, 'root' | 'maxPanes'>): boolean {
  return leavesOf(s.root).length < Math.min(s.maxPanes, MAX_PANES)
}

/** Explain the ceiling once, where the user is looking. */
function atLimit(maxPanes: number): void {
  useUi
    .getState()
    .showToast(
      maxPanes < MAX_PANES
        ? trf('Больше {n} панелей — включите плагин «Дополнительные панели»', { n: maxPanes })
        : trf('Больше {n} панелей не поддерживается', { n: maxPanes })
    )
}

export const usePanes = create<PanesState>((set, get) => {
  /** Commit a new tree, keep `activeId` valid and mirror the active pane's tab into the tabs store. */
  const commit = (root: PaneNode, activeId: string, extra: Partial<PanesState> = {}) => {
    const leaves = leavesOf(root)
    const active = leaves.find((l) => l.id === activeId) ?? leaves[0]
    const maximizedId = 'maximizedId' in extra ? extra.maximizedId! : get().maximizedId
    set({ ...extra, root, activeId: active.id, maximizedId: maximizedId && leaves.some((l) => l.id === maximizedId) ? maximizedId : null })
    const tabs = useTabs.getState()
    if (tabs.doc.activeTabId !== active.tabId) tabs.setActive(active.tabId)
    scheduleSave()
  }

  const scheduleSave = () => {
    if (get().windowMode !== 'main' || typeof localStorage === 'undefined') return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      try {
        const { root, activeId } = get()
        localStorage.setItem(LAYOUT_KEY, JSON.stringify({ root, activeId }))
      } catch {
        // quota / privacy mode — layout is a convenience only
      }
    }, 300)
  }

  return {
    root: initialLeaf,
    activeId: initialLeaf.id,
    maximizedId: null,
    detached: [],
    windowMode: 'main',
    maxPanes: CORE_MAX_PANES,

    setMaxPanes: (n) => {
      const next = clamp(Math.round(n), 1, MAX_PANES)
      if (next !== get().maxPanes) set({ maxPanes: next })
    },

    focusPane: (id) => {
      if (id === get().activeId || !findLeaf(get().root, id)) return
      commit(get().root, id, get().maximizedId ? { maximizedId: id } : {})
    },

    focusDirection: (dir) => {
      const n = neighborOf(get().root, get().activeId, dir)
      if (n) get().focusPane(n.id)
    },

    setLeafTab: (paneId, tabId) => {
      const { root, detached } = get()
      if (tabId && (detached.includes(tabId) || leavesOf(root).some((l) => l.id !== paneId && l.tabId === tabId))) return
      commit(updateLeaf(root, paneId, { tabId }), paneId)
    },

    applyPreset: (n) => {
      if (get().windowMode !== 'main') return
      if (n > Math.min(get().maxPanes, MAX_PANES)) {
        atLimit(get().maxPanes)
        return
      }
      // A pane with no tab in it is a dead end — the user has to hunt for the
      // picker before the pane does anything. Open as many requests as the
      // layout needs first, then lay them out.
      const before = get()
      const available = leavesOf(before.root).filter((l) => l.tabId).length + freeTabs(before).length
      for (let i = available; i < n; i++) useTabs.getState().openNew()
      // openNew() makes its tab active, which can re-home tabs between panes.
      const s = get()
      const current = leavesOf(s.root)
      const activeTab = findLeaf(s.root, s.activeId)?.tabId ?? null
      // Keep what is on screen (active tab first), then fill new panes with open tabs.
      const shown = current.filter((l) => l.tabId)
      shown.sort((x, y) => (x.tabId === activeTab ? -1 : y.tabId === activeTab ? 1 : 0))
      const pool: PaneLeaf[] = [...shown, ...current.filter((l) => !l.tabId)]
      const free = freeTabs(s)
      const leaves: PaneLeaf[] = []
      for (let i = 0; i < n; i++) {
        const reuse = pool[i]
        if (reuse) leaves.push(reuse.tabId || !free.length ? reuse : { ...reuse, tabId: free.shift()!.id })
        else leaves.push(newLeaf(free.shift()?.id ?? null))
      }
      commit(presetTree(n, leaves), leaves[0].id, { maximizedId: null })
    },

    splitActive: (dir) => {
      const s0 = get()
      if (s0.windowMode !== 'main') return
      if (!canGrow(s0)) {
        atLimit(s0.maxPanes)
        return
      }
      const active0 = findLeaf(s0.root, s0.activeId)
      if (!active0) return
      // The new pane gets a tab nobody is showing, or a fresh request.
      const tabId = freeTabs(s0)[0]?.id ?? useTabs.getState().openNew()
      // openNew() made that tab active, and the active pane may have taken it:
      // put the pane being split back on its own tab before splitting it.
      const root = updateLeaf(get().root, s0.activeId, { tabId: active0.tabId })
      const active = findLeaf(root, s0.activeId)
      if (!active) return
      const leaf = newLeaf(tabId)
      commit(replaceNode(root, active.id, split(dir, active, leaf)), leaf.id, { maximizedId: null })
    },

    closePane: (id) => {
      const s = get()
      const target = id ?? s.activeId
      const [parent] = ancestorsOf(s.root, target)
      const next = removeLeaf(s.root, target)
      if (!next || !parent) return
      const sibling = parent.side === 'a' ? parent.split.b : parent.split.a
      const nextActive = target === s.activeId ? leavesOf(sibling)[0].id : s.activeId
      commit(next, nextActive)
    },

    swapLeaves: (aId, bId) => {
      const s = get()
      const a = findLeaf(s.root, aId)
      const b = findLeaf(s.root, bId)
      if (!a || !b || a.id === b.id) return
      let root = replaceNode(s.root, a.id, { ...a, tabId: b.tabId, respPct: b.respPct, layout: b.layout, respDock: b.respDock, respFloat: b.respFloat })
      root = replaceNode(root, b.id, { ...b, tabId: a.tabId, respPct: a.respPct, layout: a.layout, respDock: a.respDock, respFloat: a.respFloat })
      // Focus follows the content that moved.
      const activeId = s.activeId === a.id ? b.id : s.activeId === b.id ? a.id : s.activeId
      const maximizedId = s.maximizedId === a.id ? b.id : s.maximizedId === b.id ? a.id : s.maximizedId
      commit(root, activeId, { maximizedId })
    },

    moveActive: (dir) => {
      const n = neighborOf(get().root, get().activeId, dir)
      if (n) get().swapLeaves(get().activeId, n.id)
    },

    movePaneTo: (sourceId, targetId, zone) => {
      if (sourceId === targetId) return
      if (zone === 'center') {
        get().swapLeaves(sourceId, targetId)
        return
      }
      const s = get()
      const source = findLeaf(s.root, sourceId)
      if (!source) return
      const without = removeLeaf(s.root, sourceId)
      const target = without && findLeaf(without, targetId)
      if (!without || !target) return
      const dir: SplitDir = zone === 'left' || zone === 'right' ? 'row' : 'col'
      const sourceFirst = zone === 'left' || zone === 'up'
      const node = sourceFirst ? split(dir, source, target) : split(dir, target, source)
      commit(replaceNode(without, targetId, node), sourceId, { maximizedId: null })
    },

    dropTabInto: (tabId, targetPaneId, zone) => {
      const s = get()
      if (s.windowMode !== 'main' || s.detached.includes(tabId)) return
      const target = findLeaf(s.root, targetPaneId)
      if (!target) return
      const holder = leavesOf(s.root).find((l) => l.tabId === tabId)

      // Dropping onto the middle just shows the tab here.
      if (zone === 'center' || (holder && holder.id === targetPaneId)) {
        if (holder && holder.id !== targetPaneId) set({ root: updateLeaf(s.root, holder.id, { tabId: null }) })
        get().setLeafTab(targetPaneId, tabId)
        get().focusPane(targetPaneId)
        return
      }

      // Moving a tab that already owns a pane is a pane move — keep its size and
      // response layout instead of building a fresh pane.
      if (holder) {
        get().movePaneTo(holder.id, targetPaneId, zone)
        return
      }

      if (!canGrow(s)) {
        atLimit(s.maxPanes)
        get().setLeafTab(targetPaneId, tabId)
        return
      }
      const leaf = newLeaf(tabId)
      const dir: SplitDir = zone === 'left' || zone === 'right' ? 'row' : 'col'
      const first = zone === 'left' || zone === 'up'
      const node = first ? split(dir, leaf, target) : split(dir, target, leaf)
      commit(replaceNode(s.root, targetPaneId, node), leaf.id, { maximizedId: null })
    },

    dropTabAtEdge: (tabId, side) => {
      const s = get()
      if (s.windowMode !== 'main' || s.detached.includes(tabId)) return
      const holder = leavesOf(s.root).find((l) => l.tabId === tabId)
      // A single empty-ish pane has no "outer edge" worth splitting against.
      if (leavesOf(s.root).length === 1 && (!holder || holder.tabId === tabId)) {
        const only = leavesOf(s.root)[0]
        if (!only.tabId) {
          get().setLeafTab(only.id, tabId)
          return
        }
      }
      if (holder) {
        // Detach it from its current pane first so the tab is not shown twice.
        const without = leavesOf(s.root).length > 1 ? removeLeaf(s.root, holder.id) : updateLeaf(s.root, holder.id, { tabId: null })
        if (!without) return
        const leaf = newLeaf(tabId)
        const dir: SplitDir = side === 'left' || side === 'right' ? 'row' : 'col'
        const first = side === 'left' || side === 'up'
        commit(first ? split(dir, leaf, without) : split(dir, without, leaf), leaf.id, { maximizedId: null })
        return
      }
      if (!canGrow(s)) {
        atLimit(s.maxPanes)
        get().setLeafTab(s.activeId, tabId)
        return
      }
      const leaf = newLeaf(tabId)
      const dir: SplitDir = side === 'left' || side === 'right' ? 'row' : 'col'
      const first = side === 'left' || side === 'up'
      commit(first ? split(dir, leaf, s.root) : split(dir, s.root, leaf), leaf.id, { maximizedId: null })
    },

    flipActiveGroup: () => {
      const s = get()
      const [parent] = ancestorsOf(s.root, s.activeId)
      if (!parent) return
      const p = parent.split
      commit(replaceNode(s.root, p.id, { ...p, a: p.b, b: p.a, ratio: 1 - p.ratio }), s.activeId)
    },

    resizeActive: (dir) => {
      const s = get()
      const axis: SplitDir = dir === 'left' || dir === 'right' ? 'row' : 'col'
      // Arrow keys move the nearest divider on that axis in the arrow's direction.
      const hit = ancestorsOf(s.root, s.activeId).find((a) => a.split.dir === axis)
      if (!hit) return
      const delta = dir === 'right' || dir === 'down' ? RATIO_STEP : -RATIO_STEP
      get().setRatio(hit.split.id, hit.split.ratio + delta)
    },

    setRatio: (splitId, ratio) => {
      const s = get()
      const find = (node: PaneNode): PaneSplit | null =>
        node.kind === 'leaf' ? null : node.id === splitId ? node : (find(node.a) ?? find(node.b))
      const node = find(s.root)
      if (!node) return
      set({ root: replaceNode(s.root, splitId, { ...node, ratio: clamp(ratio, RATIO_MIN, 1 - RATIO_MIN) }) })
      scheduleSave()
    },

    setRespPct: (paneId, pct) => {
      set({ root: updateLeaf(get().root, paneId, { respPct: clamp(pct, 18, 82) }) })
      scheduleSave()
    },

    toggleLeafLayout: (paneId) => {
      const leaf = findLeaf(get().root, paneId)
      if (!leaf) return
      // The shortcut keeps its old meaning: flip between below and beside.
      const next: DockMode = leaf.respDock === 'bottom' || leaf.respDock === 'top' ? 'right' : 'bottom'
      get().setRespDock(paneId, next)
      return
      scheduleSave()
    },

    setRespDock: (paneId, dock) => {
      const leaf = findLeaf(get().root, paneId)
      if (!leaf) return
      // The share is a height when docked at the bottom and a width at the sides:
      // carried across, a comfortable 30 % of the height became a 100 px column.
      const vertical = (d: DockMode): boolean => d === 'bottom' || d === 'top'
      const across = vertical(leaf.respDock) !== vertical(dock) && dock !== 'float' && leaf.respDock !== 'float'
      set({
        root: updateLeaf(get().root, paneId, {
          respDock: dock,
          layout: vertical(dock) ? 'split-v' : 'split-h',
          ...(across ? { respPct: 46 } : {})
        })
      })
      scheduleSave()
    },

    setRespFloat: (paneId, rect) => {
      set({ root: updateLeaf(get().root, paneId, { respFloat: rect }) })
      scheduleSave()
    },

    toggleMaximize: (id) => {
      const s = get()
      const target = id ?? s.activeId
      if (leavesOf(s.root).length < 2) return
      commit(s.root, target, { maximizedId: s.maximizedId === target ? null : target })
    },

    detachTab: async (tabId) => {
      const s = get()
      if (s.windowMode !== 'main') return
      if (window.api.platform === 'web') {
        useUi.getState().showToast(tr('Отдельные окна доступны в настольном приложении'), 'error')
        return
      }
      const tab = useTabs.getState().doc.tabs.find((t) => t.id === tabId)
      if (!tab) return
      if (s.detached.includes(tabId)) {
        void window.api.paneFocus(tabId)
        return
      }
      window.api.panePutSnapshot(tabId, useResponse.getState().byTab[tabId] ?? null)
      await window.api.paneDetach(tabId, tr(tab.request.name || 'Без названия'))
      const cur = get()
      const detached = [...cur.detached, tabId]
      let root = cur.root
      for (const leaf of leavesOf(root)) {
        if (leaf.tabId !== tabId) continue
        const replacement = freeTabs({ root, detached }, leaf.id)[0]?.id ?? null
        root = updateLeaf(root, leaf.id, { tabId: replacement })
      }
      commit(root, cur.activeId, { detached })
    },

    initDetached: (tabId) => {
      const leaf = { ...newLeaf(tabId), id: 'detached' }
      set({ windowMode: 'detached', root: leaf, activeId: leaf.id, maximizedId: null, detached: [] })
    }
  }
})

/* ============================================================
 * Wiring: tabs <-> panes, persistence, detached windows
 * ============================================================ */

function loadLayout(): { root: PaneNode; activeId: string } | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { root?: PaneNode; activeId?: string }
    const valid = (n: unknown): n is PaneNode => {
      const node = n as PaneNode
      if (!node || typeof node.id !== 'string') return false
      if (node.kind === 'leaf') return node.tabId === null || typeof node.tabId === 'string'
      return node.kind === 'split' && (node.dir === 'row' || node.dir === 'col') && valid(node.a) && valid(node.b)
    }
    if (!valid(parsed.root)) return null
    return { root: migrateLeaves(parsed.root), activeId: parsed.activeId ?? '' }
  } catch {
    return null
  }
}

/**
 * A layout saved by 1.2 has no dock fields: derive them from `layout` so an
 * upgrade keeps the arrangement the user had.
 */
function migrateLeaves(node: PaneNode): PaneNode {
  if (node.kind === 'leaf') {
    const base = newLeaf(node.tabId)
    return {
      ...node,
      respDock: node.respDock ?? (node.layout === 'split-h' ? 'right' : 'bottom'),
      respFloat: node.respFloat ?? base.respFloat
    }
  }
  return { ...node, a: migrateLeaves(node.a), b: migrateLeaves(node.b) }
}

/** Drop pane references to tabs that no longer exist (closed, or another workspace). */
function pruneMissingTabs(): void {
  const s = usePanes.getState()
  const ids = new Set(useTabs.getState().doc.tabs.map((t) => t.id))
  let root = s.root
  for (const leaf of leavesOf(root)) {
    if (leaf.tabId && !ids.has(leaf.tabId)) root = updateLeaf(root, leaf.id, { tabId: null })
  }
  const gone = s.detached.filter((id) => !ids.has(id))
  for (const id of gone) void window.api.paneAttach(id)
  if (root !== s.root || gone.length) {
    usePanes.setState({ root, detached: s.detached.filter((id) => ids.has(id)) })
  }
}

/** The tabs store's active tab changed (tab strip click, sidebar, new tab…). */
function followActiveTab(tabId: string | null): void {
  const s = usePanes.getState()
  const active = findLeaf(s.root, s.activeId)
  if (!tabId || active?.tabId === tabId) return
  if (s.detached.includes(tabId)) {
    // It lives in its own window: bring that forward and keep this window as it was.
    void window.api.paneFocus(tabId)
    useTabs.getState().setActive(active?.tabId ?? null)
    return
  }
  const holder = leavesOf(s.root).find((l) => l.tabId === tabId)
  if (holder) {
    usePanes.setState({ activeId: holder.id, maximizedId: s.maximizedId ? holder.id : null })
    return
  }
  if (active) usePanes.setState({ root: updateLeaf(s.root, active.id, { tabId }) })
}

let wired = false

/** Call once in the main window after bootstrap(). */
export function initPanes(): void {
  if (wired) return
  wired = true

  const saved = loadLayout()
  if (saved) {
    const leaves = leavesOf(saved.root)
    usePanes.setState({ root: saved.root, activeId: leaves.some((l) => l.id === saved.activeId) ? saved.activeId : leaves[0].id })
  }
  pruneMissingTabs()
  followActiveTab(useTabs.getState().doc.activeTabId)
  const { root, activeId } = usePanes.getState()
  const activeLeaf = findLeaf(root, activeId)
  if (activeLeaf && !activeLeaf.tabId) {
    const first = freeTabs(usePanes.getState())[0]
    if (first) usePanes.getState().setLeafTab(activeId, first.id)
  }

  // Closing the active tab: stay in the same pane with a tab no other pane shows.
  setActiveTabFallback((remaining, closedIndex) => {
    const s = usePanes.getState()
    const free = freeTabs(s, s.activeId).filter((t) => remaining.some((r) => r.id === t.id))
    if (!free.length) return null
    const order = remaining.map((t) => t.id)
    // Nearest tab wins; on a tie the one to the right (it slid into the closed slot).
    const distance = (id: string) => {
      const i = order.indexOf(id)
      return i >= closedIndex ? i - closedIndex : closedIndex - i - 0.5
    }
    free.sort((a, b) => distance(a.id) - distance(b.id))
    return free[0].id
  })

  useTabs.subscribe((state, prev) => {
    if (state.doc.tabs !== prev.doc.tabs) pruneMissingTabs()
    if (state.doc.activeTabId !== prev.doc.activeTabId) followActiveTab(state.doc.activeTabId)
  })

  // After a main-window reload, windows opened earlier are still on screen.
  void window.api.paneList().then((open) => {
    const ids = new Set(useTabs.getState().doc.tabs.map((t) => t.id))
    const detached = open.filter((id) => ids.has(id))
    if (!detached.length) return
    const s = usePanes.getState()
    let root = s.root
    for (const leaf of leavesOf(root)) {
      if (!leaf.tabId || !detached.includes(leaf.tabId)) continue
      root = updateLeaf(root, leaf.id, { tabId: freeTabs({ root, detached }, leaf.id)[0]?.id ?? null })
    }
    usePanes.setState({ root, detached })
    const active = findLeaf(root, usePanes.getState().activeId)
    useTabs.getState().setActive(active?.tabId ?? null)
  })

  window.api.onPaneClosed((tabId) => {
    const s = usePanes.getState()
    if (!s.detached.includes(tabId)) return
    usePanes.setState({ detached: s.detached.filter((id) => id !== tabId) })
    void window.api.paneTakeSnapshot(tabId).then((snap) => {
      if (!useTabs.getState().doc.tabs.some((t) => t.id === tabId)) return
      if (snap) restoreResponse(tabId, snap as TabResponse)
      const cur = usePanes.getState()
      const active = findLeaf(cur.root, cur.activeId)
      if (active && !active.tabId) cur.setLeafTab(active.id, tabId)
    })
  })
}

export function restoreResponse(tabId: string, snap: TabResponse): void {
  // A request still in flight belonged to the other window and will never land here.
  const value: TabResponse = snap.status === 'loading' ? { status: 'empty' } : snap
  useResponse.setState((s) => ({ byTab: { ...s.byTab, [tabId]: value } }))
}
