/**
 * Workspace backups.
 *
 * A backup holds everything the current workspace owns — collections,
 * environments, globals and history — in one of three shapes:
 *
 *  - **JSON** (`.relay.json`): one readable file, the format the base app uses;
 *  - **ZIP** (`.zip`): the same data split into one file per kind, so a backup
 *    can be diffed or partially inspected without a JSON viewer;
 *  - **SQLite** (`.sqlite`): a real database, for opening in SQL tooling.
 *
 * ZIP and SQLite come from the «Дополнительные форматы резервных копий» pack;
 * JSON is always available. What is NOT included: keys kept in the OS keychain
 * (AI providers, plugin secrets). What IS included, as in any export: values
 * typed into requests and variables — tokens, passwords, secret variables —
 * because they are part of the workspace documents themselves.
 */
import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate'
import type { CollectionNode, SqliteSnapshot } from '@shared/types'
import { APP_NAME, APP_VERSION } from '@shared/constants'
import { acceptSnapshot } from '@shared/backup-shape'
import { tr } from './i18n'

/** What a backup file carries; `SqliteSnapshot` predates the other formats. */
export type WorkspaceSnapshot = SqliteSnapshot

export type BackupFormat = 'json' | 'zip' | 'sqlite'

/** Envelope of the JSON format — `kind` is what import validates. */
interface BackupEnvelope {
  app: string
  kind: 'workspace-backup'
  formatVersion: 1
  appVersion: string
  exportedAt: string
  data: WorkspaceSnapshot
}

const KIND = 'workspace-backup'

export const BACKUP_FILE: Record<BackupFormat, { ext: string[]; name: string; defaultName: string }> = {
  json: { ext: ['json'], name: 'Relay backup', defaultName: 'relay-backup.relay.json' },
  zip: { ext: ['zip'], name: 'ZIP', defaultName: 'relay-backup.zip' },
  sqlite: { ext: ['sqlite', 'db'], name: 'SQLite', defaultName: 'relay-backup.sqlite' }
}

function envelope(snapshot: WorkspaceSnapshot): BackupEnvelope {
  return {
    app: APP_NAME,
    kind: KIND,
    formatVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    data: snapshot
  }
}

/** Serialize to the JSON format. */
export function toJson(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify(envelope(snapshot), null, 2)
}

/**
 * Parse the JSON format. Also accepts a bare snapshot object (no envelope) so a
 * hand-assembled file still imports.
 */
export function fromJson(text: string): WorkspaceSnapshot {
  const parsed = JSON.parse(text) as Partial<BackupEnvelope> & Partial<WorkspaceSnapshot>
  const data = parsed.kind === KIND && parsed.data ? parsed.data : (parsed as WorkspaceSnapshot)
  if (!data || !Array.isArray(data.collections)) throw new Error(tr('это не резервная копия Relay'))
  return normalize(data)
}

/** Serialize to the ZIP format (one file per kind + meta.json). */
export function toZip(snapshot: WorkspaceSnapshot): Uint8Array {
  const meta = { ...envelope(snapshot), data: undefined }
  return zipSync(
    {
      'meta.json': strToU8(JSON.stringify(meta, null, 2)),
      'collections.json': strToU8(JSON.stringify(snapshot.collections, null, 2)),
      'environments.json': strToU8(
        JSON.stringify({ environments: snapshot.environments, activeEnvironmentId: snapshot.activeEnvironmentId }, null, 2)
      ),
      'globals.json': strToU8(JSON.stringify(snapshot.globals, null, 2)),
      'history.json': strToU8(JSON.stringify(snapshot.history, null, 2))
    },
    { level: 6 }
  )
}

/** Parse the ZIP format; missing members simply come back empty. */
export function fromZip(bytes: Uint8Array): WorkspaceSnapshot {
  const files = unzipSync(bytes)
  const read = <T>(name: string, fallback: T): T => {
    const entry = files[name]
    if (!entry) return fallback
    try {
      return JSON.parse(strFromU8(entry)) as T
    } catch {
      return fallback
    }
  }
  if (!files['collections.json'] && !files['meta.json']) throw new Error(tr('в архиве нет резервной копии Relay'))
  const env = read<{ environments?: unknown; activeEnvironmentId?: unknown }>('environments.json', {})
  return normalize({
    collections: read('collections.json', []),
    environments: (env.environments as WorkspaceSnapshot['environments']) ?? [],
    activeEnvironmentId: (env.activeEnvironmentId as string | null) ?? null,
    globals: read('globals.json', []),
    history: read('history.json', [])
  })
}

/**
 * Fill in anything an older or partial file left out, and drop what the app
 * could not render — the same checks the SQLite restore applies, so «Заменить»
 * never swaps the workspace for junk from a foreign or hand-edited file.
 */
function normalize(data: Partial<WorkspaceSnapshot>): WorkspaceSnapshot {
  return acceptSnapshot(data)
}

/** Short human summary of what a snapshot contains. */
export function describeSnapshot(s: WorkspaceSnapshot): { collections: number; requests: number; environments: number; history: number } {
  let requests = 0
  const walk = (nodes: CollectionNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'request') requests++
      else walk(node.children)
    }
  }
  walk(s.collections)
  return { collections: s.collections.length, requests, environments: s.environments.length, history: s.history.length }
}

/** Base64 for the save dialog (which takes text or base64, never bytes). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
