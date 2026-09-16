import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ClientCert, ProxyConfig, SettingsDoc } from '@shared/types'
import { Toggle } from '@renderer/components/primitives'
import { Icon } from '@renderer/components/Icon'
import { makeId } from '@shared/id'
import { useSettings } from '@renderer/store/settings'
import { proxyMode, settingsToRequestSettings } from '@renderer/lib/request-runner'

import { tr } from '@renderer/lib/i18n'
/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Split a free-form bypass editor (newline/comma separated) into a clean list. */
function parseBypass(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Last path segment of a posix/windows path — what we show next to a picker. */
function basename(p: string | undefined): string | null {
  if (!p) return null
  const norm = p.replace(/\\/g, '/')
  const name = norm.slice(norm.lastIndexOf('/') + 1)
  return name.length > 0 ? name : p
}

/** A certificate is "PFX mode" once it has a pfx path; otherwise it is PEM (cert + key). */
type CertMode = 'pem' | 'pfx'
function deriveMode(cert: ClientCert): CertMode {
  return cert.pfxPath ? 'pfx' : 'pem'
}

/* ------------------------------------------------------------------ *
 * Section
 * ------------------------------------------------------------------ */

const PROXY_MODES: { id: 'off' | 'system' | 'custom'; label: string }[] = [
  { id: 'off', label: 'Без прокси' },
  { id: 'system', label: 'Системный' },
  { id: 'custom', label: 'Свой' }
]

/**
 * Send one real request through the current network settings. Reading the
 * configuration back from the UI proves nothing — only the engine can say
 * whether the proxy, the CA bundle and the certificates actually work.
 */
function ConnectionTest(): JSX.Element {
  const [url, setUrl] = useState('https://httpbin.org/get')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      const res = await window.api.sendRequest(
        {
          method: 'GET',
          url,
          query: [],
          headers: [],
          body: { type: 'none' },
          auth: { type: 'none' },
          settings: settingsToRequestSettings()
        },
        { requestId: `net-test-${Date.now()}` }
      )
      setResult(
        res.ok || res.status > 0
          ? `${tr('Ответ')}: ${res.status} ${res.statusText ?? ''} · ${Math.round(res.timings.totalMs)} ${tr('мс')}`
          : `${tr('Ошибка')}: ${res.error?.kind ?? 'unknown'} — ${res.error?.message ?? ''}`
      )
    } catch (err) {
      setResult(`${tr('Ошибка')}: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="set-group-label">{tr('Проверка соединения')}</div>
      <div className="net-block">
        <div className="field">
          <label htmlFor="net-test-url">{tr('Адрес для проверки')}</label>
          <input id="net-test-url" className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy || !url.trim()} onClick={() => void run()}>
            <Icon name="send" size={14} /> {busy ? tr('Проверяем…') : tr('Отправить тестовый запрос')}
          </button>
          {result && <span className="hint" style={{ margin: 0 }}>{result}</span>}
        </div>
        <div className="hint">
          {tr('Запрос уходит через текущие настройки прокси, CA и сертификатов — ровно так же, как обычные запросы.')}
        </div>
      </div>
    </>
  )
}

export function NetworkSection(): JSX.Element {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  const proxy = settings.proxy
  const certs = settings.clientCerts

  /* ---- proxy patch helper: never drop other proxy fields ---- */
  const patchProxy = (patch: Partial<ProxyConfig>): void => {
    update({ proxy: { ...proxy, ...patch } })
  }

  /* ---- proxy.auth: collapse to undefined when both fields are empty ---- */
  const setAuthField = (field: 'username' | 'password', value: string): void => {
    const next = {
      username: proxy.auth?.username ?? '',
      password: proxy.auth?.password ?? '',
      [field]: value
    }
    const empty = next.username.trim() === '' && next.password.trim() === ''
    patchProxy({ auth: empty ? undefined : next })
  }

  /* ---- proxy.bypass: keep a local draft so commas/newlines type freely ---- */
  // Seed once from the persisted array; thereafter the textarea owns its text and
  // we re-parse into string[] on every change. (parseBypass strips empties/whitespace.)
  const [bypassDraft, setBypassDraft] = useState<string>(() => (proxy.bypass ?? []).join('\n'))
  const onBypassChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    setBypassDraft(e.target.value)
    patchProxy({ bypass: parseBypass(e.target.value) })
  }

  const mode = proxyMode(proxy)
  const proxyOff = mode !== 'custom'

  const pickCa = async (): Promise<void> => {
    const picked = await window.api.openFile({ filters: [{ name: 'CA', extensions: ['pem', 'crt', 'cer', 'ca'] }] })
    if (picked && picked.length) update({ caPath: picked[0].filePath })
  }

  return (
    <>
      <div className="set-h">{tr('Сеть')}</div>
      <div className="set-sub"> {tr('Прокси для исходящих запросов и клиентские TLS-сертификаты. Ключевой материал читается в основном процессе — в интерфейсе хранятся только пути к файлам.')} </div>

      {/* ============================ HTTP/2 ============================ */}
      <div className="set-row">
        <div className="label">
          <div className="t">HTTP/2</div>
          <div className="d">{tr('Разрешить согласование HTTP/2 (h2) по ALPN, если сервер его поддерживает')}</div>
        </div>
        <Toggle checked={settings.http2} onChange={(v) => update({ http2: v })} />
      </div>

      {/* ============================ PROXY ============================ */}
      <div className="set-group-label">{tr('Прокси')}</div>

      <div className="set-row">
        <div className="label">
          <div className="t">{tr('Режим прокси')}</div>
          <div className="d">
            {tr('«Системный» берёт настройки прокси операционной системы, включая PAC-скрипт; «Свой» — адрес ниже.')}
          </div>
        </div>
        <div className="seg" role="group" aria-label={tr('Режим прокси')}>
          {PROXY_MODES.map((m) => (
            <button
              key={m.id}
              className={mode === m.id ? 'on' : ''}
              aria-pressed={mode === m.id}
              onClick={() => patchProxy({ mode: m.id, enabled: m.id !== 'off' })}
            >
              {tr(m.label)}
            </button>
          ))}
        </div>
      </div>

      <div className={`net-block${proxyOff ? ' net-block-off' : ''}`}>
        <div className="field">
          <label htmlFor="net-proxy-url">{tr('Адрес прокси')}</label>
          <input
            id="net-proxy-url"
            className="input mono"
            type="text"
            placeholder="http://127.0.0.1:8080"
            value={proxy.url}
            disabled={proxyOff}
            onChange={(e) => patchProxy({ url: e.target.value })}
          />
        </div>

        <div className="net-grid-2">
          <div className="field">
            <label htmlFor="net-proxy-user">{tr('Имя пользователя')}</label>
            <input
              id="net-proxy-user"
              className="input"
              type="text"
              autoComplete="off"
              placeholder={tr('необязательно')}
              value={proxy.auth?.username ?? ''}
              disabled={proxyOff}
              onChange={(e) => setAuthField('username', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="net-proxy-pass">{tr('Пароль')}</label>
            <input
              id="net-proxy-pass"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder={tr('необязательно')}
              value={proxy.auth?.password ?? ''}
              disabled={proxyOff}
              onChange={(e) => setAuthField('password', e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="net-proxy-bypass">{tr('Исключения (no-proxy)')}</label>
          <textarea
            id="net-proxy-bypass"
            className="input net-textarea mono"
            placeholder={'localhost\n127.0.0.1\n*.internal'}
            value={bypassDraft}
            disabled={proxyOff}
            onChange={onBypassChange}
          />
          <div className="hint"> {tr('По одному хосту в строке (или через запятую). Поддерживаются точные хосты, суффиксы вида')} <code>*.example.com</code> {tr('и')} <code>*</code>.
          </div>
        </div>
      </div>

      {/* ========================= TLS / CA ============================ */}
      <div className="set-group-label">{tr('Проверка сертификатов')}</div>

      <div className="set-row">
        <div className="label">
          <div className="t">{tr('Проверять SSL-сертификаты')}</div>
          <div className="d">{tr('Отклонять ответы с недоверенным или просроченным сертификатом. Отключайте только для тестовых стендов.')}</div>
        </div>
        <Toggle checked={settings.rejectUnauthorized} onChange={(v) => update({ rejectUnauthorized: v })} />
      </div>

      <div className="net-block">
        <FilePicker
          label={tr('Общий CA-сертификат (PEM)')}
          path={settings.caPath}
          onPick={() => void pickCa()}
          onClear={() => update({ caPath: '' })}
        />
        <div className="hint">
          {tr('Дополняет системное хранилище доверия — нужен, когда трафик расшифровывает корпоративный прокси.')}
        </div>
      </div>

      {/* ===================== CLIENT CERTIFICATES ===================== */}
      <div className="set-group-label">{tr('Клиентские сертификаты')}</div>
      <div className="net-cert-intro"> {tr('Сертификаты подбираются по хосту запроса — точное совпадение хоста или')} <code>host:port</code>{tr('. Используйте PEM (сертификат + ключ) или контейнер PFX/PKCS#12.')} </div>

      {certs.length === 0 && (
        <div className="net-empty">{tr('Сертификаты не добавлены.')}</div>
      )}

      <div className="net-cert-list">
        {certs.map((cert) => (
          <CertRow key={cert.id} cert={cert} certs={certs} update={update} />
        ))}
      </div>

      <button
        className="btn ghost net-add-cert"
        type="button"
        onClick={() => update({ clientCerts: [...certs, { id: makeId('cert'), host: '' }] })}
      >
        <Icon name="plus" size={14} /> {tr('Добавить сертификат')} </button>

      <ConnectionTest />
    </>
  )
}

/* ------------------------------------------------------------------ *
 * One certificate card
 * ------------------------------------------------------------------ */

function CertRow({
  cert,
  certs,
  update
}: {
  cert: ClientCert
  certs: ClientCert[]
  update: (patch: Partial<SettingsDoc>) => void
}): JSX.Element {
  // Mode is derived from stored paths, but a local override lets the user flip to an
  // (empty) PFX/PEM form before any file is picked.
  const [modeOverride, setModeOverride] = useState<CertMode | null>(null)
  const mode: CertMode = modeOverride ?? deriveMode(cert)

  // Immutable update of this cert by id.
  const patch = (p: Partial<ClientCert>): void => {
    update({ clientCerts: certs.map((c) => (c.id === cert.id ? { ...c, ...p } : c)) })
  }

  const remove = (): void => {
    update({ clientCerts: certs.filter((c) => c.id !== cert.id) })
  }

  const setMode = (next: CertMode): void => {
    setModeOverride(next)
    // Clear the other format's paths so we never persist both PEM and PFX at once.
    if (next === 'pfx') patch({ certPath: undefined, keyPath: undefined })
    else patch({ pfxPath: undefined })
  }

  // Pick a file PATH only (never read bytes in the renderer).
  const pick = async (field: 'certPath' | 'keyPath' | 'pfxPath' | 'caPath', filters?: { name: string; extensions: string[] }[]): Promise<void> => {
    const files = await window.api.openFile({ multiple: false, filters })
    if (files && files[0]) patch({ [field]: files[0].filePath })
  }

  return (
    <div className="net-cert">
      <div className="net-cert-head">
        <Icon name="key" size={15} className="net-cert-ico" />
        <input
          className="input net-cert-host"
          type="text"
          placeholder={tr('api.example.com или api.example.com:443')}
          value={cert.host}
          onChange={(e) => patch({ host: e.target.value })}
          aria-label={tr('Хост сертификата')}
        />
        <div className="seg net-cert-mode" role="group" aria-label={tr('Формат сертификата')}>
          <button type="button" className={mode === 'pem' ? 'on' : ''} onClick={() => setMode('pem')}>
            PEM
          </button>
          <button type="button" className={mode === 'pfx' ? 'on' : ''} onClick={() => setMode('pfx')}>
            PFX
          </button>
        </div>
        <button className="icon-btn" type="button" title={tr('Удалить сертификат')} aria-label={tr('Удалить сертификат')} onClick={remove}>
          <Icon name="trash" size={15} />
        </button>
      </div>

      <div className="net-cert-body">
        {mode === 'pem' ? (
          <>
            <FilePicker
              label={tr('Сертификат (CRT/PEM)')}
              path={cert.certPath}
              onPick={() => pick('certPath', [{ name: tr('Сертификат'), extensions: ['crt', 'cert', 'pem'] }])}
              onClear={() => patch({ certPath: undefined })}
            />
            <FilePicker
              label={tr('Приватный ключ (KEY/PEM)')}
              path={cert.keyPath}
              onPick={() => pick('keyPath', [{ name: tr('Ключ'), extensions: ['key', 'pem'] }])}
              onClear={() => patch({ keyPath: undefined })}
            />
          </>
        ) : (
          <FilePicker
            label={tr('Контейнер PFX/P12')}
            path={cert.pfxPath}
            onPick={() => pick('pfxPath', [{ name: 'PKCS#12', extensions: ['pfx', 'p12'] }])}
            onClear={() => patch({ pfxPath: undefined })}
          />
        )}

        <FilePicker
          label={tr('Дополнительный CA (необязательно)')}
          path={cert.caPath}
          onPick={() => pick('caPath', [{ name: tr('CA-сертификат'), extensions: ['crt', 'cert', 'pem', 'ca'] }])}
          onClear={() => patch({ caPath: undefined })}
        />

        <div className="field net-cert-pass">
          <label>{tr('Пароль (passphrase)')}</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={mode === 'pfx' ? tr('пароль контейнера') : tr('если ключ зашифрован')}
            value={cert.passphrase ?? ''}
            onChange={(e) => patch({ passphrase: e.target.value === '' ? undefined : e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * File picker row — shows the picked basename + a clear button
 * ------------------------------------------------------------------ */

function FilePicker({
  label,
  path,
  onPick,
  onClear
}: {
  label: string
  path: string | undefined
  onPick: () => void
  onClear: () => void
}): JSX.Element {
  const name = useMemo(() => basename(path), [path])
  return (
    <div className="field net-picker">
      <label>{label}</label>
      <div className="net-picker-row">
        <button className="btn ghost net-pick-btn" type="button" onClick={onPick} title={path ?? undefined}>
          <Icon name="upload" size={13} />
          <span className="net-pick-name">{name ?? tr('Выбрать файл')}</span>
        </button>
        {path && (
          <button className="icon-btn" type="button" title={tr('Очистить')} aria-label={tr('Очистить файл')} onClick={onClear}>
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
