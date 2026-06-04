import { useState } from 'react'
import type { Auth, OAuth2Grant, RequestModel } from '@shared/types'
import { Field, Segmented } from '@renderer/components/primitives'
import { HighlightedInput } from '@renderer/components/HighlightedInput'
import { useTabs } from '@renderer/store/tabs'
import { useScope, useActiveTab } from '@renderer/lib/hooks'
import { useCollections } from '@renderer/store/collections'

const AUTH_TYPES: { id: Auth['type']; label: string }[] = [
  { id: 'inherit', label: 'Inherit' },
  { id: 'none', label: 'No Auth' },
  { id: 'bearer', label: 'Bearer' },
  { id: 'basic', label: 'Basic' },
  { id: 'apikey', label: 'API Key' },
  { id: 'oauth2', label: 'OAuth 2.0' },
  { id: 'digest', label: 'Digest' }
]

export function AuthTab({ req }: { req: RequestModel }) {
  const patch = useTabs((s) => s.patchActive)
  const scope = useScope()
  const tab = useActiveTab()
  const inheritedAuth = useCollections((s) => s.inheritedAuthFor(tab?.savedRequestId ?? null))
  const auth = req.auth

  const setAuth = (a: Auth) => patch({ auth: a })

  const changeType = (type: Auth['type']) => {
    switch (type) {
      case 'none':
        return setAuth({ type: 'none' })
      case 'inherit':
        return setAuth({ type: 'inherit' })
      case 'bearer':
        return setAuth({ type: 'bearer', token: auth.type === 'bearer' ? auth.token : '{{token}}' })
      case 'basic':
        return setAuth({ type: 'basic', username: '', password: '' })
      case 'apikey':
        return setAuth({ type: 'apikey', key: 'X-API-Key', value: '{{api_key}}', addTo: 'header' })
      case 'oauth2':
        return setAuth({ type: 'oauth2', grant: 'client_credentials', accessToken: '', headerPrefix: 'Bearer' })
      case 'digest':
        return setAuth({ type: 'digest', username: '', password: '' })
    }
  }

  return (
    <div style={{ padding: '16px 14px', maxWidth: 600 }}>
      <Field label="Тип авторизации">
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {AUTH_TYPES.map((t) => (
            <button key={t.id} className={auth.type === t.id ? 'on' : ''} onClick={() => changeType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </Field>

      {auth.type === 'inherit' && (
        <div style={{ color: 'var(--tx-2)', fontSize: 12.5, padding: '8px 0' }}>
          Наследует авторизацию от родителя — сейчас это <b style={{ color: 'var(--tx-0)' }}>{inheritedAuth.type}</b>.
        </div>
      )}
      {auth.type === 'none' && (
        <div style={{ color: 'var(--tx-2)', fontSize: 12.5, padding: '8px 0' }}>Этот запрос не использует авторизацию.</div>
      )}

      {auth.type === 'bearer' && (
        <Field label="Token">
          <div className="input mono" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--tx-3)' }}>Bearer</span>
            <HighlightedInput value={auth.token} onChange={(token) => setAuth({ ...auth, token })} scope={scope} placeholder="{{token}}" />
          </div>
        </Field>
      )}

      {auth.type === 'basic' && (
        <>
          <Field label="Username">
            <input className="input" value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })} />
          </Field>
          <Field label="Password">
            <input className="input" type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
          </Field>
        </>
      )}

      {auth.type === 'apikey' && (
        <>
          <Field label="Key">
            <input className="input mono" value={auth.key} onChange={(e) => setAuth({ ...auth, key: e.target.value })} />
          </Field>
          <Field label="Value">
            <div className="input mono" style={{ display: 'flex', alignItems: 'center' }}>
              <HighlightedInput value={auth.value} onChange={(value) => setAuth({ ...auth, value })} scope={scope} placeholder="{{api_key}}" />
            </div>
          </Field>
          <Field label="Добавить в">
            <Segmented
              value={auth.addTo}
              onChange={(addTo) => setAuth({ ...auth, addTo })}
              options={[
                { value: 'header', label: 'Header' },
                { value: 'query', label: 'Query Params' }
              ]}
            />
          </Field>
        </>
      )}

      {auth.type === 'digest' && (
        <>
          <Field label="Username">
            <input className="input" value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })} />
          </Field>
          <Field label="Password">
            <input className="input" type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
          </Field>
          <div style={{ color: 'var(--tx-3)', fontSize: 11.5 }}>
            Digest реализован по упрощённой схеме (P1). Полный challenge/response — в планах.
          </div>
        </>
      )}

      {auth.type === 'oauth2' && <OAuth2Fields auth={auth} setAuth={setAuth} />}
    </div>
  )
}

function OAuth2Fields({ auth, setAuth }: { auth: Extract<Auth, { type: 'oauth2' }>; setAuth: (a: Auth) => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const getToken = async () => {
    if (!auth.tokenUrl) {
      setMsg('Укажите Token URL')
      return
    }
    setBusy(true)
    setMsg(null)
    const res = await window.api.oauthToken({
      grant: auth.grant,
      tokenUrl: auth.tokenUrl,
      clientId: auth.clientId ?? '',
      clientSecret: auth.clientSecret,
      scope: auth.scope,
      username: auth.username,
      password: auth.password
    })
    setBusy(false)
    if (res.ok && res.accessToken) {
      setAuth({ ...auth, accessToken: res.accessToken })
      setMsg('Токен получен')
    } else {
      setMsg(res.error ?? 'Не удалось получить токен')
    }
  }

  return (
    <>
      <Field label="Grant Type">
        <Segmented
          value={auth.grant}
          onChange={(grant) => setAuth({ ...auth, grant: grant as OAuth2Grant })}
          options={[
            { value: 'client_credentials', label: 'Client Credentials' },
            { value: 'password', label: 'Password' },
            { value: 'authorization_code', label: 'Auth Code' }
          ]}
        />
      </Field>
      <Field label="Access Token">
        <input className="input mono" value={auth.accessToken} placeholder="(пусто — получите ниже)" onChange={(e) => setAuth({ ...auth, accessToken: e.target.value })} />
      </Field>
      <Field label="Token URL">
        <input className="input mono" value={auth.tokenUrl ?? ''} onChange={(e) => setAuth({ ...auth, tokenUrl: e.target.value })} placeholder="https://auth.example.com/oauth/token" />
      </Field>
      <Field label="Client ID">
        <input className="input mono" value={auth.clientId ?? ''} onChange={(e) => setAuth({ ...auth, clientId: e.target.value })} />
      </Field>
      <Field label="Client Secret">
        <input className="input mono" type="password" value={auth.clientSecret ?? ''} onChange={(e) => setAuth({ ...auth, clientSecret: e.target.value })} />
      </Field>
      {auth.grant === 'password' && (
        <>
          <Field label="Username">
            <input className="input" value={auth.username ?? ''} onChange={(e) => setAuth({ ...auth, username: e.target.value })} />
          </Field>
          <Field label="Password">
            <input className="input" type="password" value={auth.password ?? ''} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
          </Field>
        </>
      )}
      <Field label="Scope">
        <input className="input mono" value={auth.scope ?? ''} onChange={(e) => setAuth({ ...auth, scope: e.target.value })} placeholder="read write" />
      </Field>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn primary" onClick={getToken} disabled={busy}>
          {busy ? 'Запрос…' : 'Получить токен'}
        </button>
        {msg && <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>{msg}</span>}
      </div>
    </>
  )
}
