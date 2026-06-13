import { useEffect, useState } from 'react'
import type { PluginInfo, PluginPermission, PluginRunKind, PluginThemeContribution, SettingsDoc } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { Toggle } from '@renderer/components/primitives'
import { usePlugins } from '@renderer/store/plugins'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'

/** Human consequence line per permission token (consent must be readable). */
function permissionLabel(p: PluginPermission): string {
  if (p === 'net') return 'Доступ в интернет — любой хост'
  if (p.startsWith('net:')) return `Доступ в интернет — только ${p.slice('net:'.length)}`
  if (p === 'request:read') return 'Чтение запроса: метод, URL и заголовки (значения известных секретных заголовков скрыты)'
  if (p === 'response:read') return 'Чтение ответа, включая тело (до 200 КБ) — может содержать токены'
  if (p === 'request:write') return 'Изменение запроса перед отправкой'
  if (p === 'storage') return 'Своё хранилище данных'
  if (p === 'clipboard') return 'Запись в буфер обмена'
  if (p === 'history:read') return 'Чтение истории запросов'
  return p
}

const RUN_KIND_LABEL: Record<PluginRunKind, string> = {
  button: 'кнопка',
  response: 'хук ответа',
  request: 'хук запроса',
  panel: 'панель',
  command: 'команда',
  workspace: 'хук пространства',
  collection: 'хук коллекции'
}

function lastRunLabel(event: PluginRunKind): string {
  return RUN_KIND_LABEL[event] ?? event
}

const chipStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 100,
  border: '1px solid var(--line-2)',
  background: 'var(--bg-2)',
  color: 'var(--tx-1)',
  whiteSpace: 'nowrap'
}

const warnChipStyle: React.CSSProperties = {
  ...chipStyle,
  borderColor: 'color-mix(in oklch, var(--s-4xx, #d97706) 50%, transparent)',
  color: 'var(--s-4xx, #d97706)'
}

function PluginCard({ info }: { info: PluginInfo }): JSX.Element {
  const setEnabled = usePlugins((s) => s.setEnabled)
  const setConfig = usePlugins((s) => s.setConfig)
  const setSecret = usePlugins((s) => s.setSecret)
  const setNetAllowlist = usePlugins((s) => s.setNetAllowlist)
  const deletePlugin = usePlugins((s) => s.deletePlugin)
  const customTheme = useSettings((s) => s.settings.customTheme)
  const themePreset = useSettings((s) => s.settings.themePreset)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** Per-secret-field local draft (kept out of info.config — secrets never round-trip). */
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({})
  const [newHost, setNewHost] = useState('')

  // Reset the delete confirmation after a beat so a stray click can't linger.
  useEffect(() => {
    if (!confirmDelete) return
    const t = window.setTimeout(() => setConfirmDelete(false), 4000)
    return () => window.clearTimeout(t)
  }, [confirmDelete])

  const m = info.manifest
  const buttons = m.contributes.buttons ?? []
  const panels = m.contributes.panels ?? []
  const commands = m.contributes.commands ?? []
  const themes = m.contributes.themes ?? []
  const events = m.contributes.events ?? []
  const broken = !!info.error
  const missingPerms = m.permissions.filter((p) => !info.granted.includes(p))
  const hasBroadNet = m.permissions.includes('net')

  const saveSecret = (key: string): void => {
    const value = secretDraft[key]
    if (value === undefined) return
    void setSecret(m.id, key, value)
    setSecretDraft((d) => {
      const next = { ...d }
      delete next[key]
      return next
    })
  }

  const buttonLocationLabel = (loc: string): string =>
    loc === 'response-toolbar' ? 'панель ответа' : loc === 'titlebar' ? 'верхняя панель' : 'боковая панель'

  const applyTheme = (t: PluginThemeContribution): void => {
    const s = useSettings.getState().settings
    const patch: Partial<SettingsDoc> = {
      themePreset: 'custom',
      customTheme: { base: t.base, vars: t.vars, source: { pluginId: m.id, themeId: t.id } }
    }
    // Stash the user's own appearance once, so chained plugin themes don't
    // clobber the backup; revert restores it.
    if (!s.customTheme?.source) {
      patch.appearanceSnapshot = { themePreset: s.themePreset, customTheme: s.customTheme }
    }
    useSettings.getState().update(patch)
    useUi.getState().showToast(`Тема «${t.label}» применена`)
  }

  const revertTheme = (): void => {
    const s = useSettings.getState().settings
    const snap = s.appearanceSnapshot
    useSettings.getState().update({
      themePreset: snap?.themePreset ?? 'relay',
      customTheme: snap?.customTheme ?? null,
      appearanceSnapshot: null
    })
    useUi.getState().showToast('Прежняя тема восстановлена')
  }

  // Applied = provenance matches AND the custom preset is still active — after
  // the user switches appearance manually the revert affordance must disappear.
  const isApplied = (t: PluginThemeContribution): boolean =>
    themePreset === 'custom' && customTheme?.source?.pluginId === m.id && customTheme.source.themeId === t.id

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-1)',
        padding: '14px 16px',
        marginBottom: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            {m.name}
            <span style={{ fontSize: 11, color: 'var(--tx-3)', fontWeight: 400 }}>v{m.version}</span>
            {m.author && <span style={{ fontSize: 11, color: 'var(--tx-3)', fontWeight: 400 }}>· {m.author}</span>}
          </div>
          {m.description && (
            <div style={{ fontSize: 12, color: 'var(--tx-2)', marginTop: 3 }}>{m.description}</div>
          )}
        </div>
        {!broken && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title="Включение выдаёт перечисленные разрешения">
            <span style={{ fontSize: 11.5, color: 'var(--tx-2)' }}>
              {info.enabled ? 'Включён' : m.permissions.length ? 'Включить и разрешить' : 'Включить'}
            </span>
            <Toggle checked={info.enabled} onChange={(v) => void setEnabled(m.id, v)} />
          </div>
        )}
        <button
          className="icon-btn"
          title={confirmDelete ? 'Нажмите ещё раз — удалить папку плагина' : 'Удалить плагин'}
          style={confirmDelete ? { color: 'var(--s-5xx)' } : undefined}
          onClick={() => {
            if (confirmDelete) void deletePlugin(m.id)
            else setConfirmDelete(true)
          }}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>

      {confirmDelete && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--s-5xx)' }}>
          Папка плагина будет удалена с диска. Нажмите корзину ещё раз для подтверждения.
        </div>
      )}

      {broken && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--s-5xx)' }}>
          <Icon name="warn" size={14} />
          {info.error}
        </div>
      )}

      {info.needsRegrant && !broken && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--s-4xx, #d97706)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="warn" size={14} />
            Обновление плагина запрашивает новые разрешения — включите его заново, чтобы выдать их:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {missingPerms.map((p) => (
              <span key={p} style={warnChipStyle}>
                + {permissionLabel(p)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        <span style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>Разрешения:</span>
        {m.permissions.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>не требуются</span>}
        {m.permissions.map((p) => (
          <span key={p} style={chipStyle} title={p}>
            {permissionLabel(p)}
          </span>
        ))}
      </div>

      {(buttons.length > 0 || panels.length > 0 || commands.length > 0 || events.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {buttons.map((b) => (
            <span key={b.id} style={{ ...chipStyle, color: 'var(--tx-2)' }}>
              Кнопка «{b.label}» — {buttonLocationLabel(b.location)}
            </span>
          ))}
          {panels.map((p) => (
            <span key={p.id} style={{ ...chipStyle, color: 'var(--tx-2)' }}>
              Панель «{p.label}»{p.interactive ? ' (интерактивная)' : ''} — вкладка ответа
            </span>
          ))}
          {commands.map((c) => (
            <span key={c.id} style={{ ...chipStyle, color: 'var(--tx-2)' }}>
              Команда «{c.title}» — палитра (⌘K)
            </span>
          ))}
          {events.includes('response') && (
            <span style={{ ...chipStyle, color: 'var(--tx-2)' }}>Хук: после каждого ответа</span>
          )}
          {events.includes('request') && (
            <span style={{ ...chipStyle, color: 'var(--tx-2)' }}>Хук: перед каждым запросом</span>
          )}
          {events.includes('workspace') && (
            <span style={{ ...chipStyle, color: 'var(--tx-2)' }}>Хук: смена пространства</span>
          )}
          {events.includes('collection') && (
            <span style={{ ...chipStyle, color: 'var(--tx-2)' }}>Хук: изменение коллекций</span>
          )}
        </div>
      )}

      {/* Per-host grant editor — narrow a broad `net` grant to specific hosts. */}
      {hasBroadNet && info.enabled && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12.5, marginBottom: 4 }}>
            Сеть: разрешённые хосты
            <span style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
              {' '}
              {info.netAllowlist.length ? '(плагин ограничен этим списком)' : '(пусто = любой хост)'}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {info.netAllowlist.map((h) => (
              <span key={h} style={{ ...chipStyle, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {h}
                <button
                  className="icon-btn"
                  style={{ width: 16, height: 16 }}
                  title="Убрать"
                  onClick={() => void setNetAllowlist(m.id, info.netAllowlist.filter((x) => x !== h))}
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))}
            <input
              className="input mono"
              placeholder="example.com или *.example.com"
              value={newHost}
              onChange={(e) => setNewHost(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const host = newHost.trim().toLowerCase()
                if (!host) return
                if (!/^(\*\.)?[a-z0-9]([a-z0-9.-]{0,253})(:\d{1,5})?$/.test(host)) {
                  useUi.getState().showToast('Некорректный хост (пример: example.com или *.example.com)', 'error')
                  return
                }
                if (info.netAllowlist.includes(host)) {
                  useUi.getState().showToast('Этот хост уже в списке', 'error')
                  return
                }
                void setNetAllowlist(m.id, [...info.netAllowlist, host])
                setNewHost('')
              }}
              style={{ width: 220, height: 26 }}
            />
          </div>
        </div>
      )}

      {info.lastRun && (
        <div style={{ marginTop: 10, fontSize: 11.5 }}>
          <span style={{ color: info.lastRun.error ? 'var(--s-5xx)' : 'var(--tx-3)' }}>
            Последний запуск ({lastRunLabel(info.lastRun.event)}, {info.lastRun.durationMs} мс):{' '}
            {info.lastRun.error ? info.lastRun.error : 'ок'}
          </span>
          {info.lastRun.logs.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--tx-3)' }}>
                Логи ({info.lastRun.logs.length})
              </summary>
              <pre
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--tx-2)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: '6px 0 0',
                  maxHeight: 140,
                  overflow: 'auto'
                }}
              >
                {info.lastRun.logs.map((l) => `[${l.level}] ${l.message}`).join('\n')}
              </pre>
            </details>
          )}
        </div>
      )}

      {m.config.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {m.config.map((f) => {
            if (f.type === 'secret') {
              const isSet = info.secretKeysSet.includes(f.key)
              const draft = secretDraft[f.key]
              const editing = draft !== undefined
              return (
                <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5 }}>
                      {f.label}
                      <Icon name="key" size={12} style={{ marginLeft: 6, color: 'var(--tx-3)', verticalAlign: 'middle' }} />
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
                      {f.description ? f.description + ' · ' : ''}
                      {isSet ? 'сохранено в безопасном хранилище' : 'не задано'}
                    </div>
                  </div>
                  <input
                    className="input mono"
                    type="password"
                    placeholder={isSet ? '•••••••• (сохранено)' : f.placeholder}
                    value={draft ?? ''}
                    onChange={(e) => setSecretDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveSecret(f.key)
                    }}
                    style={{ width: 200 }}
                  />
                  <button
                    className="btn ghost"
                    style={{ height: 30 }}
                    disabled={!editing}
                    onClick={() => saveSecret(f.key)}
                    title="Сохранить секрет"
                  >
                    Сохранить
                  </button>
                  {isSet && (
                    <button
                      className="icon-btn"
                      title="Очистить секрет"
                      onClick={() => {
                        // Drop any in-progress draft so the field doesn't keep
                        // showing (and re-saving) text that no longer applies.
                        setSecretDraft((d) => {
                          const next = { ...d }
                          delete next[f.key]
                          return next
                        })
                        void setSecret(m.id, f.key, '')
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              )
            }
            return (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5 }}>{f.label}</div>
                  {f.description && <div style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>{f.description}</div>}
                </div>
                <input
                  className="input mono"
                  type="text"
                  placeholder={f.placeholder}
                  value={info.config[f.key] ?? ''}
                  onChange={(e) => setConfig(m.id, { ...info.config, [f.key]: e.target.value })}
                  style={{ width: 280 }}
                />
              </div>
            )
          })}
        </div>
      )}

      {themes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {themes.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <Icon name={t.base === 'dark' ? 'moon' : 'sun'} size={14} style={{ color: 'var(--tx-3)' }} />
              <div style={{ flex: 1, fontSize: 12.5 }}>
                Тема «{t.label}»{' '}
                <span style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
                  ({t.base === 'dark' ? 'тёмная' : 'светлая'})
                </span>
              </div>
              {isApplied(t) ? (
                <button className="btn ghost" style={{ height: 28 }} onClick={revertTheme}>
                  Вернуть прежнюю
                </button>
              ) : (
                <button className="btn ghost" style={{ height: 28 }} onClick={() => applyTheme(t)}>
                  Применить
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PluginsSection(): JSX.Element {
  const plugins = usePlugins((s) => s.plugins)
  const loaded = usePlugins((s) => s.loaded)
  const refresh = usePlugins((s) => s.refresh)
  const installSample = usePlugins((s) => s.installSample)
  const installFromZip = usePlugins((s) => s.installFromZip)
  const [confirmReinstall, setConfirmReinstall] = useState(false)

  useEffect(() => {
    void usePlugins.getState().init()
  }, [])

  // Auto-disarm the overwrite confirmation so it can't linger indefinitely.
  useEffect(() => {
    if (!confirmReinstall) return
    const t = window.setTimeout(() => setConfirmReinstall(false), 4000)
    return () => window.clearTimeout(t)
  }, [confirmReinstall])

  const onInstallSample = async (): Promise<void> => {
    if (confirmReinstall) {
      setConfirmReinstall(false)
      await installSample(true)
      return
    }
    const outcome = await installSample(false)
    if (outcome === 'exists') setConfirmReinstall(true)
  }

  return (
    <>
      <div className="set-h">Плагины</div>
      <div className="set-sub">
        Плагины — папки в каталоге данных приложения; они подхватываются автоматически (hot-reload). Код плагина
        выполняется в изолированной песочнице и получает только те разрешения, которые вы выдали при включении.
        Формат описан в docs/PLUGINS.md.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={() => void window.api.pluginsOpenFolder()}>
          <Icon name="folder" size={14} />
          Открыть папку плагинов
        </button>
        <button className="btn ghost" onClick={() => void onInstallSample()}>
          <Icon name="download" size={14} />
          {confirmReinstall ? 'Перезаписать пример?' : 'Установить пример'}
        </button>
        <button className="btn ghost" onClick={() => void installFromZip()}>
          <Icon name="upload" size={14} />
          Установить из .zip
        </button>
        <button className="btn ghost" onClick={() => void refresh()}>
          <Icon name="refresh" size={14} />
          Обновить
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginBottom: 18 }}>
        {confirmReinstall
          ? 'Папка webhook-forwarder уже существует — повторное нажатие перезапишет её файлы.'
          : 'Пример можно переустановить в любой момент — правьте его копию как шаблон.'}
      </div>

      {loaded && plugins.length === 0 && (
        <div
          style={{
            border: '1px dashed var(--line-2)',
            borderRadius: 'var(--radius-md)',
            padding: '22px 18px',
            fontSize: 12.5,
            color: 'var(--tx-2)'
          }}
        >
          Плагинов пока нет. Нажмите «Установить пример» — он добавит кнопку «В webhook» на панель ответа и тему
          Forge Green, а заодно послужит шаблоном для собственных плагинов.
        </div>
      )}

      {plugins.map((p) => (
        <PluginCard key={p.manifest.id} info={p} />
      ))}
    </>
  )
}
