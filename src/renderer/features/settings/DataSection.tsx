import { useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { useCollections } from '@renderer/store/collections'
import { useEnvironments } from '@renderer/store/environments'
import { useHistory } from '@renderer/store/history'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { useCap } from '@renderer/store/features'
import { tr, trf } from '@renderer/lib/i18n'
import {
  BACKUP_FILE,
  base64ToBytes,
  bytesToBase64,
  describeSnapshot,
  fromJson,
  fromZip,
  toJson,
  toZip,
  type BackupFormat,
  type WorkspaceSnapshot
} from '@renderer/lib/backup'

/** Everything the current workspace owns, as it sits in the stores right now. */
function gatherSnapshot(): WorkspaceSnapshot {
  const env = useEnvironments.getState()
  return {
    collections: useCollections.getState().doc.collections,
    environments: env.env.environments,
    activeEnvironmentId: env.env.activeEnvironmentId,
    globals: env.globals.variables,
    history: useHistory.getState().doc.entries
  }
}

/** Add a backup's contents to what is already here; nothing is overwritten. */
function mergeSnapshot(snapshot: WorkspaceSnapshot): void {
  const cols = useCollections.getState()
  for (const c of snapshot.collections) cols.addCollectionNode(c)

  const env = useEnvironments.getState()
  for (const e of snapshot.environments) env.addEnvironment(e)

  if (snapshot.globals.length) {
    const existing = env.globals.variables
    const seen = new Set(existing.map((v) => v.key))
    env.setGlobalVars([...existing, ...snapshot.globals.filter((v) => !seen.has(v.key))])
  }

  if (snapshot.history.length) {
    const max = useSettings.getState().settings.maxHistory ?? 200
    const current = useHistory.getState().doc.entries
    const seen = new Set(current.map((h) => h.id))
    useHistory.getState().setAll([...snapshot.history.filter((h) => !seen.has(h.id)), ...current].slice(0, Math.max(0, max)))
  }
}

/** Make the workspace exactly what the backup holds. */
function replaceSnapshot(snapshot: WorkspaceSnapshot): void {
  useCollections.getState().setAll(snapshot.collections)

  const env = useEnvironments.getState()
  for (const existing of [...env.env.environments]) env.deleteEnv(existing.id)
  for (const e of snapshot.environments) env.addEnvironment(e)
  env.setActiveEnv(snapshot.activeEnvironmentId)
  env.setGlobalVars(snapshot.globals)

  const max = useSettings.getState().settings.maxHistory ?? 200
  useHistory.getState().setAll(snapshot.history.slice(0, Math.max(0, max)))
}

type ImportMode = 'merge' | 'replace'

export function DataSection(): JSX.Element {
  const showToast = useUi((s) => s.showToast)
  const hasExtra = useCap('backup.extra')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<ImportMode>('merge')
  const [confirmReplace, setConfirmReplace] = useState(false)

  const formats: BackupFormat[] = hasExtra ? ['json', 'zip', 'sqlite'] : ['json']

  const doExport = async (format: BackupFormat): Promise<void> => {
    setBusy(true)
    try {
      const snapshot = gatherSnapshot()
      const file = BACKUP_FILE[format]
      let content: string
      let base64 = false

      if (format === 'json') {
        content = toJson(snapshot)
      } else if (format === 'zip') {
        content = bytesToBase64(toZip(snapshot))
        base64 = true
      } else {
        const exported = await window.api.sqliteExport(snapshot)
        if (!exported) {
          showToast(tr('Экспорт недоступен'), 'error')
          return
        }
        content = exported
        base64 = true
      }

      const saved = await window.api.saveFile({
        defaultName: file.defaultName,
        content,
        base64,
        filters: [{ name: file.name, extensions: file.ext }]
      })
      if (saved) showToast(tr('Резервная копия сохранена'))
    } catch (err) {
      showToast(`${tr('Ошибка экспорта')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (format: BackupFormat): Promise<void> => {
    // Replacing wipes the workspace, so it takes a second, deliberate click.
    if (mode === 'replace' && !confirmReplace) {
      setConfirmReplace(true)
      window.setTimeout(() => setConfirmReplace(false), 4000)
      return
    }
    setConfirmReplace(false)
    setBusy(true)
    try {
      const file = BACKUP_FILE[format]
      const picked = await window.api.openFile({ filters: [{ name: file.name, extensions: file.ext }] })
      if (!picked || picked.length === 0) return

      let snapshot: WorkspaceSnapshot
      if (format === 'json') {
        snapshot = fromJson(await window.api.readTextFile(picked[0].filePath))
      } else if (format === 'zip') {
        snapshot = fromZip(base64ToBytes(await window.api.readBinaryFile(picked[0].filePath)))
      } else {
        snapshot = (await window.api.sqliteImport(picked[0].filePath)).snapshot
      }

      if (mode === 'replace') replaceSnapshot(snapshot)
      else mergeSnapshot(snapshot)

      const counts = describeSnapshot(snapshot)
      showToast(
        trf('Восстановлено: коллекций {collections} (запросов {requests}), сред {environments}, записей истории {history}', {
          collections: counts.collections,
          requests: counts.requests,
          environments: counts.environments,
          history: counts.history
        })
      )
    } catch (err) {
      showToast(`${tr('Ошибка импорта')}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="set-h">{tr('Данные')}</div>
      <div className="set-sub" style={{ maxWidth: 620 }}>
        {tr(
          'Резервная копия текущего рабочего пространства: коллекции, окружения, глобальные переменные и история. Ключи и токены в копию не попадают — они хранятся в защищённом хранилище операционной системы.'
        )}
      </div>

      <div className="set-group-label">{tr('Создать копию')}</div>
      <div className="backup-row">
        {formats.map((format) => (
          <button key={format} className={`btn${format === 'json' ? ' primary' : ''}`} disabled={busy} onClick={() => void doExport(format)}>
            <Icon name="download" size={15} /> {BACKUP_FILE[format].name}
          </button>
        ))}
      </div>
      <div className="set-sub" style={{ fontSize: 12, marginTop: 8 }}>
        {hasExtra
          ? tr('JSON — один читаемый файл. ZIP — по файлу на раздел, удобно сравнивать. SQLite — настоящая база, открывается любым SQL-браузером.')
          : tr('JSON — один читаемый файл. ZIP и SQLite добавляет плагин «Дополнительные форматы резервных копий».')}
      </div>

      <div className="set-group-label">{tr('Восстановить')}</div>
      <div className="set-row">
        <div className="label">
          <div className="t">{tr('Как применять копию')}</div>
          <div className="d">
            {mode === 'merge'
              ? tr('Добавить к текущим данным: существующие коллекции, среды и история сохраняются.')
              : tr('Заменить рабочее пространство содержимым копии. Текущие данные будут потеряны.')}
          </div>
        </div>
        <div className="seg" role="group" aria-label={tr('Как применять копию')}>
          <button className={mode === 'merge' ? 'on' : ''} aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>
            {tr('Добавить')}
          </button>
          <button className={mode === 'replace' ? 'on' : ''} aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>
            {tr('Заменить')}
          </button>
        </div>
      </div>

      <div className="backup-row">
        {formats.map((format) => (
          <button key={format} className="btn" disabled={busy} onClick={() => void doImport(format)}>
            <Icon name="upload" size={15} /> {BACKUP_FILE[format].name}
          </button>
        ))}
      </div>
      {confirmReplace && (
        <div className="set-sub" style={{ fontSize: 12, marginTop: 8, color: 'var(--danger, #d14343)' }}>
          {tr('Нажмите ещё раз, чтобы заменить все данные рабочего пространства.')}
        </div>
      )}
    </div>
  )
}
