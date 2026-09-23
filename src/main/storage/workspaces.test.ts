/**
 * StorageManager owns the per-workspace document files. What must hold:
 * a workspace never reads or writes another workspace's data, the workspaces
 * meta file survives corruption without orphaning existing workspaces, and
 * deleting a workspace leaves the app on a valid one.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_VERSION } from '@shared/constants'

const state = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  ipcMain: { handle: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const { StorageManager } = await import('./index')

let root: string

beforeEach(() => {
  state.userData = mkdtempSync(join(tmpdir(), 'relay-ws-'))
  root = join(state.userData, 'relay-data')
})

afterEach(() => {
  rmSync(state.userData, { recursive: true, force: true })
})

const wsFile = (id: string, key: string): string => join(root, 'ws', id, `${key}.json`)
const readDoc = (id: string, key: string): any => JSON.parse(readFileSync(wsFile(id, key), 'utf8'))

describe('StorageManager workspaces', () => {
  it('keeps documents of different workspaces apart', async () => {
    const storage = new StorageManager()
    const first = storage.listWorkspaces().activeId
    storage.set('globals', { version: STORAGE_VERSION, variables: [{ key: 'in-first', value: '1', enabled: true }] })
    await storage.flush()

    const second = storage.createWorkspace('Second')
    await storage.switchWorkspace(second.id)
    const inSecond = await storage.get('globals')
    expect(inSecond.variables).toEqual([])

    storage.set('globals', { version: STORAGE_VERSION, variables: [{ key: 'in-second', value: '2', enabled: true }] })
    await storage.flush()

    expect(readDoc(first, 'globals').variables[0].key).toBe('in-first')
    expect(readDoc(second.id, 'globals').variables[0].key).toBe('in-second')

    await storage.switchWorkspace(first)
    expect((await storage.get('globals')).variables[0].key).toBe('in-first')
  })

  it('flushes a pending edit into the workspace it belongs to when switching', async () => {
    const storage = new StorageManager()
    const first = storage.listWorkspaces().activeId
    const second = storage.createWorkspace('Second')
    // Saved but still inside the debounce window when the user switches.
    storage.set('globals', { version: STORAGE_VERSION, variables: [{ key: 'late', value: 'x', enabled: true }] })
    await storage.switchWorkspace(second.id)
    await storage.flush()
    expect(readDoc(first, 'globals').variables[0].key).toBe('late')
    expect(readDoc(second.id, 'globals').variables).toEqual([])
  })

  it('keeps app-level documents shared across workspaces', async () => {
    const storage = new StorageManager()
    const settings = await storage.get('settings')
    storage.set('settings', { ...settings, maxHistory: 7 })
    const second = storage.createWorkspace('Second')
    await storage.switchWorkspace(second.id)
    expect((await storage.get('settings')).maxHistory).toBe(7)
    await storage.flush()
    expect(JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')).maxHistory).toBe(7)
    expect(existsSync(wsFile(second.id, 'settings'))).toBe(false)
  })

  it('never deletes the last workspace and stays on a valid one', async () => {
    const storage = new StorageManager()
    const first = storage.listWorkspaces().activeId
    expect(await storage.deleteWorkspace(first)).toBeNull()

    const second = storage.createWorkspace('Second')
    await storage.switchWorkspace(second.id)
    expect(await storage.deleteWorkspace(second.id)).toBe(first)
    expect(storage.listWorkspaces().activeId).toBe(first)
    expect(existsSync(join(root, 'ws', second.id))).toBe(false)
  })

  it('rebuilds a corrupt workspaces meta without orphaning existing workspaces', async () => {
    const storage = new StorageManager()
    const second = storage.createWorkspace('Проекты 🚀')
    await storage.switchWorkspace(second.id)
    storage.set('globals', { version: STORAGE_VERSION, variables: [{ key: 'keep', value: 'me', enabled: true }] })
    await storage.flush()

    // Simulate a half-written meta file (power cut during writeMeta).
    writeFileSync(join(root, 'workspaces.json'), '{"version":1,"workspaces":[{"id":"', 'utf8')

    const reopened = new StorageManager()
    const rebuilt = reopened.listWorkspaces().workspaces
    expect(rebuilt.map((w) => w.id)).toContain(second.id)
    expect(rebuilt.find((w) => w.id === second.id)?.name).toBe('Проекты 🚀')
    await reopened.switchWorkspace(second.id)
    expect((await reopened.get('globals')).variables[0].key).toBe('keep')
  })

  it('migrates legacy root-level documents into the default workspace', async () => {
    mkdirSync(root, { recursive: true })
    writeFileSync(
      join(root, 'globals.json'),
      JSON.stringify({ version: STORAGE_VERSION, variables: [{ key: 'legacy', value: 'v', enabled: true }] }),
      'utf8'
    )
    const storage = new StorageManager()
    expect((await storage.get('globals')).variables[0].key).toBe('legacy')
    expect(existsSync(join(root, 'globals.json'))).toBe(false)
  })
})

describe('StorageManager workspace name recovery', () => {
  it('backfills the name of a workspace created by an older build', async () => {
    const storage = new StorageManager()
    const second = storage.createWorkspace('Команда')
    // An older build did not keep a name beside the documents.
    rmSync(join(root, 'ws', second.id, 'workspace.json'), { force: true })

    // Opening the app once writes it back...
    new StorageManager()
    // ...so a later meta loss still recovers the real name.
    writeFileSync(join(root, 'workspaces.json'), 'not json at all', 'utf8')
    const recovered = new StorageManager().listWorkspaces().workspaces
    expect(recovered.find((w) => w.id === second.id)?.name).toBe('Команда')
  })
})
