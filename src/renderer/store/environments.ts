import { create } from 'zustand'
import type { Environment, EnvironmentsDoc, GlobalsDoc, VariableDef } from '@shared/types'
import { STORAGE_VERSION } from '@shared/constants'
import { makeId } from '@shared/id'
import { flattenVariables } from '@shared/interpolate'
import { emptyEnvironments, emptyGlobals } from './defaults'
import { persist } from './persist'

interface EnvState {
  env: EnvironmentsDoc
  globals: GlobalsDoc
  hydrate: (env: EnvironmentsDoc, globals: GlobalsDoc) => void
  setActiveEnv: (id: string | null) => void
  createEnv: (name: string) => string
  addEnvironment: (env: Environment) => void
  duplicateEnv: (id: string) => void
  deleteEnv: (id: string) => void
  renameEnv: (id: string, name: string) => void
  setEnvVars: (id: string, variables: VariableDef[]) => void
  setGlobalVars: (variables: VariableDef[]) => void
  activeEnv: () => Environment | null
  envScope: () => Record<string, string>
  globalScope: () => Record<string, string>
}

export const useEnvironments = create<EnvState>((set, get) => ({
  env: emptyEnvironments(),
  globals: emptyGlobals(),

  hydrate: (env, globals) => set({ env: { ...env, version: STORAGE_VERSION }, globals: { ...globals, version: STORAGE_VERSION } }),

  setActiveEnv: (id) => {
    const env = { ...get().env, activeEnvironmentId: id }
    set({ env })
    persist('environments', env)
  },

  createEnv: (name) => {
    const id = makeId('env')
    const env = { ...get().env, environments: [...get().env.environments, { id, name, variables: [] }] }
    set({ env })
    persist('environments', env)
    return id
  },

  addEnvironment: (environment) => {
    const env = { ...get().env, environments: [...get().env.environments, environment] }
    set({ env })
    persist('environments', env)
  },

  duplicateEnv: (id) => {
    const src = get().env.environments.find((e) => e.id === id)
    if (!src) return
    const copy: Environment = { id: makeId('env'), name: `${src.name} copy`, variables: src.variables.map((v) => ({ ...v })) }
    const env = { ...get().env, environments: [...get().env.environments, copy] }
    set({ env })
    persist('environments', env)
  },

  deleteEnv: (id) => {
    const environments = get().env.environments.filter((e) => e.id !== id)
    const activeEnvironmentId = get().env.activeEnvironmentId === id ? null : get().env.activeEnvironmentId
    const env = { ...get().env, environments, activeEnvironmentId }
    set({ env })
    persist('environments', env)
  },

  renameEnv: (id, name) => {
    const environments = get().env.environments.map((e) => (e.id === id ? { ...e, name } : e))
    const env = { ...get().env, environments }
    set({ env })
    persist('environments', env)
  },

  setEnvVars: (id, variables) => {
    const environments = get().env.environments.map((e) => (e.id === id ? { ...e, variables } : e))
    const env = { ...get().env, environments }
    set({ env })
    persist('environments', env)
  },

  setGlobalVars: (variables) => {
    const globals = { ...get().globals, variables }
    set({ globals })
    persist('globals', globals)
  },

  activeEnv: () => {
    const { env } = get()
    return env.environments.find((e) => e.id === env.activeEnvironmentId) ?? null
  },

  envScope: () => flattenVariables(get().activeEnv()?.variables),
  globalScope: () => flattenVariables(get().globals.variables)
}))
