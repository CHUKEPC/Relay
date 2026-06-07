import { useState } from 'react'
import type { SqliteSnapshot } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useCollections } from '@renderer/store/collections'
import { useEnvironments } from '@renderer/store/environments'
import { useHistory } from '@renderer/store/history'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { STORAGE_VERSION } from '@shared/constants'

function gatherSnapshot(): SqliteSnapshot {
  const env = useEnvironments.getState()
  return {
    collections: useCollections.getState().doc.collections,
    environments: env.env.environments,
    activeEnvironmentId: env.env.activeEnvironmentId,
    globals: env.globals.variables,
    history: useHistory.getState().doc.entries
  }
}

export function DataSection(): JSX.Element {
  const showToast = useUi((s) => s.showToast)
  const [busy, setBusy] = useState(false)

  const doExport = async (): Promise<void> => {
    setBusy(true)
    try {
      const snap = gatherSnapshot()
      const base64 = await window.api.sqliteExport(snap)
      if (!base64) {
        showToast('Экспорт недоступен')
        return
      }
      const saved = await window.api.saveFile({
        defaultName: 'relay-backup.sqlite',
        content: base64,
        base64: true,
        filters: [{ name: 'SQLite', extensions: ['sqlite', 'db'] }]
      })
      if (saved) showToast('Резервная копия SQLite сохранена')
    } catch (err) {
      showToast(`Ошибка экспорта: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const doImport = async (): Promise<void> => {
    setBusy(true)
    try {
      const picked = await window.api.openFile({ filters: [{ name: 'SQLite', extensions: ['sqlite', 'db'] }] })
      if (!picked || picked.length === 0) return
      const { snapshot, summary } = await window.api.sqliteImport(picked[0].filePath)

      // Merge (append) into the current workspace — never silently overwrite.
      const cols = useCollections.getState()
      for (const c of snapshot.collections) cols.addCollectionNode(c)

      const env = useEnvironments.getState()
      for (const e of snapshot.environments) env.addEnvironment(e)

      if (snapshot.globals.length) {
        const existing = env.globals.variables
        const seen = new Set(existing.map((v) => v.key))
        const merged = [...existing, ...snapshot.globals.filter((v) => !seen.has(v.key))]
        env.setGlobalVars(merged)
      }

      if (snapshot.history.length) {
        const max = useSettings.getState().settings.maxHistory ?? 200
        const cur = useHistory.getState().doc.entries
        const seen = new Set(cur.map((h) => h.id))
        const entries = [...snapshot.history.filter((h) => !seen.has(h.id)), ...cur].slice(0, Math.max(0, max))
        useHistory.setState({ doc: { version: STORAGE_VERSION, entries } })
      }

      showToast(
        `Импортировано из SQLite — коллекций: ${summary.collections} (запросов: ${summary.requests}), сред: ${summary.environments}`
      )
    } catch (err) {
      showToast(`Ошибка импорта: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="set-h">Резервная копия (SQLite)</div>
      <div className="set-sub" style={{ maxWidth: 580 }}>
        Экспорт и импорт данных текущего рабочего пространства (коллекции, среды, глобальные переменные, история) в
        переносимый файл <code>.sqlite</code>. Это полноценная база SQLite — её можно открыть в любом SQLite-браузере.
        Основное хранилище приложения остаётся JSON; SQLite служит форматом резервной копии и обмена.
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => void doExport()} disabled={busy}>
          <Icon name="download" size={15} />
          Экспорт в SQLite
        </button>
        <button className="btn" onClick={() => void doImport()} disabled={busy}>
          <Icon name="upload" size={15} />
          Импорт из SQLite
        </button>
      </div>

      <div className="set-sub" style={{ marginTop: 18, fontSize: 12 }}>
        Импорт добавляет данные к текущим (не перезаписывает). Повторяющиеся глобальные переменные и записи истории
        пропускаются по ключу/идентификатору.
      </div>
    </div>
  )
}
