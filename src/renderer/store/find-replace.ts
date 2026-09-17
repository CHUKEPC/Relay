/**
 * Workspace-wide find & replace. The search itself lives in
 * `lib/find-replace.ts`; this store holds the query, the selected hits and the
 * writes back into the collections / environments stores.
 */
import { create } from 'zustand'
import type { CollectionFolderNode, RequestModel } from '@shared/types'
import {
  applyToEnvironment,
  applyToFolder,
  applyToRequest,
  applyToVariables,
  buildMatcher,
  DEFAULT_AREAS,
  fieldsOfCollections,
  fieldsOfVariables,
  search,
  type FindArea,
  type FindOptions,
  type Hit
} from '@renderer/lib/find-replace'
import { useCollections } from './collections'
import { useEnvironments } from './environments'
import { useTabs } from './tabs'
import { useUi } from './ui'
import { tr, trf } from '@renderer/lib/i18n'

/** Where to look, in addition to the collection tree. */
export interface FindScopes {
  collections: boolean
  environments: boolean
  globals: boolean
}

interface FindReplaceState {
  open: boolean
  query: string
  replacement: string
  matchCase: boolean
  wholeWord: boolean
  useRegex: boolean
  areas: FindArea[]
  scopes: FindScopes
  hits: Hit[]
  /** ids of the hits a replace will touch */
  selected: Set<string>
  /** the query is a regex the engine cannot compile */
  badPattern: boolean
  searched: boolean

  openDialog: (query?: string) => void
  close: () => void
  setQuery: (v: string) => void
  setReplacement: (v: string) => void
  toggleFlag: (flag: 'matchCase' | 'wholeWord' | 'useRegex') => void
  toggleArea: (area: FindArea) => void
  toggleScope: (scope: keyof FindScopes) => void
  toggleHit: (id: string) => void
  selectAll: (value: boolean) => void
  run: () => void
  replaceSelected: () => void
}

function options(s: Pick<FindReplaceState, 'query' | 'matchCase' | 'wholeWord' | 'useRegex' | 'areas'>): FindOptions {
  return { query: s.query, matchCase: s.matchCase, wholeWord: s.wholeWord, useRegex: s.useRegex, areas: s.areas }
}

/** Folder fields that `updateFolderMeta` can carry. */
const FOLDER_META = ['description', 'preRequestScript', 'testScript', 'variables'] as const

export const useFindReplace = create<FindReplaceState>((set, get) => ({
  open: false,
  query: '',
  replacement: '',
  matchCase: false,
  wholeWord: false,
  useRegex: false,
  areas: [...DEFAULT_AREAS],
  scopes: { collections: true, environments: true, globals: true },
  hits: [],
  selected: new Set<string>(),
  badPattern: false,
  searched: false,

  openDialog: (query) => {
    set({ open: true, ...(query !== undefined ? { query } : {}) })
    if (get().query) get().run()
  },
  close: () => set({ open: false }),

  setQuery: (v) => set({ query: v }),
  setReplacement: (v) => set({ replacement: v }),

  toggleFlag: (flag) => {
    set({ [flag]: !get()[flag] } as Partial<FindReplaceState>)
    get().run()
  },
  toggleArea: (area) => {
    set({ areas: get().areas.includes(area) ? get().areas.filter((a) => a !== area) : [...get().areas, area] })
    get().run()
  },
  toggleScope: (scope) => {
    set({ scopes: { ...get().scopes, [scope]: !get().scopes[scope] } })
    get().run()
  },

  toggleHit: (id) =>
    set((s) => {
      const selected = new Set(s.selected)
      if (selected.has(id)) selected.delete(id)
      else selected.add(id)
      return { selected }
    }),

  selectAll: (value) => set((s) => ({ selected: value ? new Set(s.hits.map((h) => h.id)) : new Set<string>() })),

  run: () => {
    const s = get()
    if (!s.query) {
      set({ hits: [], selected: new Set<string>(), badPattern: false, searched: false })
      return
    }
    if (!buildMatcher(s)) {
      set({ hits: [], selected: new Set<string>(), badPattern: true, searched: true })
      return
    }
    const fields = []
    if (s.scopes.collections) fields.push(...fieldsOfCollections(useCollections.getState().doc.collections))
    if (s.scopes.environments) {
      for (const env of useEnvironments.getState().env.environments) {
        fields.push(...fieldsOfVariables('environment', env.id, trf('Окружение «{name}»', { name: env.name }), env.name, env.variables))
      }
    }
    if (s.scopes.globals) {
      fields.push(...fieldsOfVariables('globals', 'globals', tr('Глобальные переменные'), null, useEnvironments.getState().globals.variables))
    }
    const hits = search(fields, options(s), s.replacement)
    // Everything found is staged for replacement; unticking is the exception.
    set({ hits, selected: new Set(hits.map((h) => h.id)), badPattern: false, searched: true })
  },

  replaceSelected: () => {
    const s = get()
    const hits = s.hits.filter((h) => s.selected.has(h.id))
    if (!hits.length) return

    const envs = useEnvironments.getState()
    const changedRequests: Record<string, RequestModel> = {}
    let occurrences = 0

    // Applied one hit at a time against the current store, so several hits in
    // the same request (URL + header + body…) all land.
    for (const { field, replaced, count } of hits) {
      const collections = useCollections.getState()
      occurrences += count
      if (field.ownerKind === 'request') {
        const current = collections.getRequest(field.ownerId)
        if (!current) continue
        const next = applyToRequest(current, field.path, replaced)
        collections.updateRequest(field.ownerId, next)
        changedRequests[field.ownerId] = next
      } else if (field.ownerKind === 'folder') {
        const located = collections.locate(field.ownerId)
        if (!located || located.node.type === 'request') continue
        if (field.path.t === 'name') {
          collections.renameNode(field.ownerId, replaced)
          continue
        }
        const next = applyToFolder(located.node as CollectionFolderNode, field.path, replaced)
        const patch: Partial<CollectionFolderNode> = {}
        for (const key of FOLDER_META) if (next[key] !== located.node[key]) Object.assign(patch, { [key]: next[key] })
        collections.updateFolderMeta(field.ownerId, patch)
      } else if (field.ownerKind === 'environment') {
        const env = useEnvironments.getState().env.environments.find((e) => e.id === field.ownerId)
        if (!env) continue
        const next = applyToEnvironment(env, field.path, replaced)
        if (field.path.t === 'name') envs.renameEnv(env.id, next.name)
        else envs.setEnvVars(env.id, next.variables)
      } else {
        envs.setGlobalVars(applyToVariables(useEnvironments.getState().globals.variables, field.path, replaced))
      }
    }

    // Tabs hold their own copy of a saved request: refresh the untouched ones
    // so the rename the user just made is what they see.
    useTabs.getState().refreshSaved(changedRequests)

    useUi.getState().showToast(trf('Заменено вхождений: {n} (полей: {fields})', { n: occurrences, fields: hits.length }))
    get().run()
  }
}))
