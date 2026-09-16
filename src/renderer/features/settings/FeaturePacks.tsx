import { Icon } from '@renderer/components/Icon'
import { Toggle } from '@renderer/components/primitives'
import { useFeatures } from '@renderer/store/features'
import type { Capability, FeaturePluginInfo } from '@shared/features'

import { tr } from '@renderer/lib/i18n'
/** Plain-Russian consequence of each capability, shown under the pack name. */
const CAPABILITY_LABEL: Record<Capability, string> = {
  'protocol.websocket': 'Протокол WebSocket в выборе протокола',
  'protocol.sse': 'Протокол Server-Sent Events',
  'protocol.socketio': 'Протокол Socket.IO',
  'protocol.mqtt': 'Протокол MQTT',
  'protocol.grpc': 'Протокол gRPC',
  ai: 'Вкладка и панель AI-ассистента, раздел «AI-провайдеры»',
  'auth.advanced': 'Схемы Digest, JWT, OAuth 1.0, AWS, Hawk, Akamai, ASAP, NTLM',
  'i18n.extra': 'Дополнительные языки интерфейса',
  'panes.extra': 'До 16 панелей вместо четырёх'
}

const LOCALE_NAME: Record<string, string> = {
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  zh: '中文'
}

function PackRow({ pack }: { pack: FeaturePluginInfo }): JSX.Element {
  const setEnabled = useFeatures((s) => s.setEnabled)
  return (
    <div className="set-row">
      <div className="label">
        <div className="t">
          {pack.name}
          <span className="pack-ver">{pack.version}</span>
        </div>
        <div className="d">{pack.error ? `Ошибка: ${pack.error}` : pack.description}</div>
        {!pack.error && (
          <div className="pack-caps">
            {pack.capabilities.map((c) => (
              <span key={c} className="pack-cap">
                {CAPABILITY_LABEL[c] ?? c}
              </span>
            ))}
            {pack.locales?.length ? (
              <span className="pack-cap">{pack.locales.map((l) => LOCALE_NAME[l] ?? l).join(', ')}</span>
            ) : null}
          </div>
        )}
      </div>
      <Toggle checked={pack.enabled} disabled={!!pack.error} onChange={(v) => void setEnabled(pack.id, v)} />
    </div>
  )
}

/**
 * Settings group for the capability packs shipped in the app's `plugins/`
 * folder. These are declarative (no code runs), so unlike user plugins they ask
 * for no permissions — turning one off simply removes its UI.
 */
export function FeaturePacks(): JSX.Element {
  const packs = useFeatures((s) => s.plugins)
  const loaded = useFeatures((s) => s.loaded)

  return (
    <>
      <div className="set-group-label">{tr('Комплекты возможностей')}</div>
      <div className="set-sub"> {tr('Базовое приложение — это HTTP-запросы, шесть основных схем авторизации, русский и английский языки и до четырёх панелей. Всё остальное лежит в папке')} <code>plugins</code> {tr('рядом с приложением: удалите папку — возможность исчезнет, выключите тумблер — скроется до включения. Код такие комплекты не выполняют.')} </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={() => void window.api.featuresOpenFolder()}>
          <Icon name="folder" size={14} /> {tr('Открыть папку plugins')} </button>
      </div>

      {!loaded && <div className="set-sub">{tr('Загрузка…')}</div>}
      {loaded && !packs.length && (
        <div className="set-sub"> {tr('Папка')} <code>plugins</code> {tr('пуста или недоступна — приложение работает в базовом составе.')} </div>
      )}
      {packs.map((p) => (
        <PackRow key={p.id} pack={p} />
      ))}
    </>
  )
}
