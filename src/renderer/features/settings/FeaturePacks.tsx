import { useEffect, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { Popover, Toggle } from '@renderer/components/primitives'
import { useFeatures } from '@renderer/store/features'
import type { Capability, FeaturePluginInfo } from '@shared/features'

import { tr, trf } from '@renderer/lib/i18n'
/** Plain-language consequence of each capability, shown in the pack's info. */
const CAPABILITY_LABEL: Record<Capability, string> = {
  'protocol.websocket': 'Протокол WebSocket в выборе протокола',
  'protocol.sse': 'Протокол Server-Sent Events',
  'protocol.socketio': 'Протокол Socket.IO',
  'protocol.mqtt': 'Протокол MQTT',
  'protocol.grpc': 'Протокол gRPC',
  ai: 'Вкладка и панель AI-ассистента, раздел «AI-провайдеры»',
  'auth.advanced': 'Схемы Digest, JWT, OAuth 1.0, AWS, Hawk, Akamai, ASAP, NTLM',
  'i18n.extra': 'Дополнительные языки интерфейса',
  'panes.extra': 'До 16 панелей вместо четырёх',
  'backup.extra': 'Резервные копии в ZIP и SQLite'
}

const LOCALE_NAME: Record<string, string> = {
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  zh: '中文'
}

/**
 * One row of the plugin list for a capability pack. Everything explanatory
 * lives behind the info button so the list itself stays scannable; the row
 * carries only the name, the version and the three actions.
 */
export function PackRow({ pack }: { pack: FeaturePluginInfo }): JSX.Element {
  const setEnabled = useFeatures((s) => s.setEnabled)
  const [confirmRemove, setConfirmRemove] = useState(false)

  // Taking a pack out of the list is a deliberate, two-click action.
  useEffect(() => {
    if (!confirmRemove) return
    const t = window.setTimeout(() => setConfirmRemove(false), 4000)
    return () => window.clearTimeout(t)
  }, [confirmRemove])

  const remove = async (): Promise<void> => {
    if (!confirmRemove) {
      setConfirmRemove(true)
      return
    }
    setConfirmRemove(false)
    useFeatures.getState().setPlugins(await window.api.featuresRemove(pack.id))
  }

  return (
    <div className="set-row">
      <div className="label">
        <div className="t">
          {tr(pack.name)}
          <span className="pack-ver">{pack.version}</span>
        </div>
        {pack.error && <div className="d err">{trf('Ошибка: {message}', { message: pack.error })}</div>}
        {confirmRemove && <div className="d">{tr('Нажмите корзину ещё раз, чтобы убрать. Папка плагина останется на месте.')}</div>}
      </div>

      <Popover
        trigger={
          <button className="icon-btn" title={tr('О плагине')}>
            <Icon name="info" size={15} />
          </button>
        }
      >
        <div className="plugin-info">
          <div className="plugin-info-h">{tr(pack.name)}</div>
          {pack.description && <p>{tr(pack.description)}</p>}
          {!!pack.capabilities.length && (
            <>
              <div className="plugin-info-sub">{tr('Что добавляет')}</div>
              <ul>
                {pack.capabilities.map((c) => (
                  <li key={c}>{tr(CAPABILITY_LABEL[c] ?? c)}</li>
                ))}
              </ul>
            </>
          )}
          {!!pack.locales?.length && (
            <>
              <div className="plugin-info-sub">{tr('Языки')}</div>
              <p>{pack.locales.map((l) => LOCALE_NAME[l] ?? l).join(', ')}</p>
            </>
          )}
          <div className="plugin-info-sub">{tr('Папка')}</div>
          <p className="mono plugin-info-path">{pack.dir}</p>
          <button className="btn ghost" style={{ height: 28 }} onClick={() => void window.api.featuresOpenFolder()}>
            <Icon name="folder" size={13} /> {tr('Открыть папку')}
          </button>
        </div>
      </Popover>

      <button
        className="icon-btn"
        title={confirmRemove ? tr('Нажмите ещё раз, чтобы убрать') : tr('Убрать из списка')}
        onClick={() => void remove()}
      >
        <Icon name="trash" size={14} style={confirmRemove ? { color: 'var(--danger, #d14343)' } : undefined} />
      </button>

      <Toggle
        checked={pack.enabled}
        disabled={!!pack.error}
        title={pack.enabled ? tr('Выключить') : tr('Включить')}
        onChange={(v) => void setEnabled(pack.id, v)}
      />
    </div>
  )
}
