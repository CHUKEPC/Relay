import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ClientCert, ProxyConfig, SettingsDoc } from '@shared/types'
import { Toggle } from '@renderer/components/primitives'
import { Icon } from '@renderer/components/Icon'
import { makeId } from '@shared/id'
import { useSettings } from '@renderer/store/settings'

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

  const proxyOff = !proxy.enabled

  return (
    <>
      <div className="set-h">Сеть</div>
      <div className="set-sub">
        Прокси для исходящих запросов и клиентские TLS-сертификаты. Ключевой материал читается
        в основном процессе — в интерфейсе хранятся только пути к файлам.
      </div>

      {/* ============================ PROXY ============================ */}
      <div className="set-group-label">Прокси</div>

      <div className="set-row">
        <div className="label">
          <div className="t">Использовать прокси</div>
          <div className="d">Направлять HTTP/HTTPS-запросы через указанный прокси-сервер</div>
        </div>
        <Toggle checked={proxy.enabled} onChange={(enabled) => patchProxy({ enabled })} />
      </div>

      <div className={`net-block${proxyOff ? ' net-block-off' : ''}`}>
        <div className="field">
          <label htmlFor="net-proxy-url">Адрес прокси</label>
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
            <label htmlFor="net-proxy-user">Имя пользователя</label>
            <input
              id="net-proxy-user"
              className="input"
              type="text"
              autoComplete="off"
              placeholder="необязательно"
              value={proxy.auth?.username ?? ''}
              disabled={proxyOff}
              onChange={(e) => setAuthField('username', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="net-proxy-pass">Пароль</label>
            <input
              id="net-proxy-pass"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="необязательно"
              value={proxy.auth?.password ?? ''}
              disabled={proxyOff}
              onChange={(e) => setAuthField('password', e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="net-proxy-bypass">Исключения (no-proxy)</label>
          <textarea
            id="net-proxy-bypass"
            className="input net-textarea mono"
            placeholder={'localhost\n127.0.0.1\n*.internal'}
            value={bypassDraft}
            disabled={proxyOff}
            onChange={onBypassChange}
          />
          <div className="hint">
            По одному хосту в строке (или через запятую). Поддерживаются точные хосты,
            суффиксы вида <code>*.example.com</code> и <code>*</code>.
          </div>
        </div>
      </div>

      {/* ===================== CLIENT CERTIFICATES ===================== */}
      <div className="set-group-label">Клиентские сертификаты</div>
      <div className="net-cert-intro">
        Сертификаты подбираются по хосту запроса — точное совпадение хоста или <code>host:port</code>.
        Используйте PEM (сертификат + ключ) или контейнер PFX/PKCS#12.
      </div>

      {certs.length === 0 && (
        <div className="net-empty">Сертификаты не добавлены.</div>
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
        <Icon name="plus" size={14} />
        Добавить сертификат
      </button>
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
          placeholder="api.example.com или api.example.com:443"
          value={cert.host}
          onChange={(e) => patch({ host: e.target.value })}
          aria-label="Хост сертификата"
        />
        <div className="seg net-cert-mode" role="group" aria-label="Формат сертификата">
          <button type="button" className={mode === 'pem' ? 'on' : ''} onClick={() => setMode('pem')}>
            PEM
          </button>
          <button type="button" className={mode === 'pfx' ? 'on' : ''} onClick={() => setMode('pfx')}>
            PFX
          </button>
        </div>
        <button className="icon-btn" type="button" title="Удалить сертификат" aria-label="Удалить сертификат" onClick={remove}>
          <Icon name="trash" size={15} />
        </button>
      </div>

      <div className="net-cert-body">
        {mode === 'pem' ? (
          <>
            <FilePicker
              label="Сертификат (CRT/PEM)"
              path={cert.certPath}
              onPick={() => pick('certPath', [{ name: 'Сертификат', extensions: ['crt', 'cert', 'pem'] }])}
              onClear={() => patch({ certPath: undefined })}
            />
            <FilePicker
              label="Приватный ключ (KEY/PEM)"
              path={cert.keyPath}
              onPick={() => pick('keyPath', [{ name: 'Ключ', extensions: ['key', 'pem'] }])}
              onClear={() => patch({ keyPath: undefined })}
            />
          </>
        ) : (
          <FilePicker
            label="Контейнер PFX/P12"
            path={cert.pfxPath}
            onPick={() => pick('pfxPath', [{ name: 'PKCS#12', extensions: ['pfx', 'p12'] }])}
            onClear={() => patch({ pfxPath: undefined })}
          />
        )}

        <FilePicker
          label="Дополнительный CA (необязательно)"
          path={cert.caPath}
          onPick={() => pick('caPath', [{ name: 'CA-сертификат', extensions: ['crt', 'cert', 'pem', 'ca'] }])}
          onClear={() => patch({ caPath: undefined })}
        />

        <div className="field net-cert-pass">
          <label>Пароль (passphrase)</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={mode === 'pfx' ? 'пароль контейнера' : 'если ключ зашифрован'}
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
          <span className="net-pick-name">{name ?? 'Выбрать файл'}</span>
        </button>
        {path && (
          <button className="icon-btn" type="button" title="Очистить" aria-label="Очистить файл" onClick={onClear}>
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
