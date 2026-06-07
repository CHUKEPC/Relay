import { useState } from 'react'
import type { Auth, JwtAlg, OAuth2Grant, RequestModel } from '@shared/types'
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
  { id: 'digest', label: 'Digest' },
  { id: 'jwt', label: 'JWT' },
  { id: 'oauth1', label: 'OAuth 1.0' },
  { id: 'aws', label: 'AWS Signature' },
  { id: 'hawk', label: 'Hawk' },
  { id: 'akamai', label: 'Akamai' },
  { id: 'asap', label: 'ASAP' },
  { id: 'ntlm', label: 'NTLM' }
]

const JWT_ALGS: JwtAlg[] = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512']

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
      case 'jwt':
        return setAuth({
          type: 'jwt',
          algorithm: 'HS256',
          secret: '',
          payload: '{\n  "sub": "1234567890"\n}',
          headerPrefix: 'Bearer',
          addTo: 'header'
        })
      case 'oauth1':
        return setAuth({
          type: 'oauth1',
          consumerKey: '',
          consumerSecret: '',
          signatureMethod: 'HMAC-SHA1',
          addTo: 'header'
        })
      case 'aws':
        return setAuth({ type: 'aws', accessKey: '', secretKey: '', region: 'us-east-1', service: '', sessionToken: '' })
      case 'hawk':
        return setAuth({ type: 'hawk', id: '', key: '', algorithm: 'sha256' })
      case 'akamai':
        return setAuth({ type: 'akamai', clientToken: '', clientSecret: '', accessToken: '' })
      case 'asap':
        return setAuth({ type: 'asap', issuer: '', audience: '', keyId: '', privateKey: '' })
      case 'ntlm':
        return setAuth({ type: 'ntlm', username: '', password: '', domain: '', workstation: '' })
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
            Полный Digest по RFC 7616: запрос отправляется без авторизации, а на ответ 401 с
            заголовком <span className="mono">WWW-Authenticate: Digest</span> автоматически
            вычисляется ответ (MD5/SHA-256, qop=auth) и запрос повторяется.
          </div>
        </>
      )}

      {auth.type === 'oauth2' && <OAuth2Fields auth={auth} setAuth={setAuth} />}

      {auth.type === 'jwt' && (
        <>
          <Field label="Алгоритм">
            <select className="input mono" value={auth.algorithm} onChange={(e) => setAuth({ ...auth, algorithm: e.target.value as JwtAlg })}>
              {JWT_ALGS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Secret или приватный ключ (PEM для RS/PS)">
            <textarea
              className="input mono"
              value={auth.secret}
              onChange={(e) => setAuth({ ...auth, secret: e.target.value })}
              rows={5}
              spellCheck={false}
              style={{ resize: 'vertical', minHeight: 84 }}
            />
          </Field>
          <div style={{ color: 'var(--tx-3)', fontSize: 11.5, marginTop: -6, marginBottom: 8 }}>
            Для HS* — общий секрет, для RS*/PS* — PEM приватный ключ.
          </div>
          <Field label="Payload (JSON)">
            <textarea
              className="input mono"
              value={auth.payload}
              onChange={(e) => setAuth({ ...auth, payload: e.target.value })}
              rows={6}
              spellCheck={false}
              style={{ resize: 'vertical', minHeight: 96 }}
            />
          </Field>
          <Field label="Префикс заголовка">
            <input className="input mono" value={auth.headerPrefix} onChange={(e) => setAuth({ ...auth, headerPrefix: e.target.value })} placeholder="Bearer" />
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
          {auth.addTo === 'query' && (
            <Field label="Имя query-параметра">
              <input className="input mono" value={auth.queryParamName ?? ''} onChange={(e) => setAuth({ ...auth, queryParamName: e.target.value })} placeholder="token" />
            </Field>
          )}
        </>
      )}

      {auth.type === 'oauth1' && (
        <>
          <Field label="Consumer Key">
            <div className="input mono" style={{ display: 'flex', alignItems: 'center' }}>
              <HighlightedInput value={auth.consumerKey} onChange={(consumerKey) => setAuth({ ...auth, consumerKey })} scope={scope} placeholder="{{consumer_key}}" />
            </div>
          </Field>
          <Field label="Consumer Secret">
            <input className="input mono" type="password" value={auth.consumerSecret} onChange={(e) => setAuth({ ...auth, consumerSecret: e.target.value })} />
          </Field>
          <Field label="Token">
            <div className="input mono" style={{ display: 'flex', alignItems: 'center' }}>
              <HighlightedInput value={auth.token ?? ''} onChange={(token) => setAuth({ ...auth, token })} scope={scope} placeholder="(необязательно)" />
            </div>
          </Field>
          <Field label="Token Secret">
            <input className="input mono" type="password" value={auth.tokenSecret ?? ''} onChange={(e) => setAuth({ ...auth, tokenSecret: e.target.value })} placeholder="(необязательно)" />
          </Field>
          <Field label="Signature Method">
            <Segmented
              value={auth.signatureMethod}
              onChange={(signatureMethod) => setAuth({ ...auth, signatureMethod })}
              options={[
                { value: 'HMAC-SHA1', label: 'HMAC-SHA1' },
                { value: 'HMAC-SHA256', label: 'HMAC-SHA256' },
                { value: 'PLAINTEXT', label: 'PLAINTEXT' }
              ]}
            />
          </Field>
          <div style={{ color: 'var(--tx-3)', fontSize: 11.5 }}>
            Подпись добавляется в заголовок <span className="mono">Authorization: OAuth …</span>.
          </div>
        </>
      )}

      {auth.type === 'aws' && (
        <>
          <Field label="Access Key">
            <div className="input mono" style={{ display: 'flex', alignItems: 'center' }}>
              <HighlightedInput value={auth.accessKey} onChange={(accessKey) => setAuth({ ...auth, accessKey })} scope={scope} placeholder="{{aws_access_key}}" />
            </div>
          </Field>
          <Field label="Secret Key">
            <input className="input mono" type="password" value={auth.secretKey} onChange={(e) => setAuth({ ...auth, secretKey: e.target.value })} />
          </Field>
          <Field label="Region">
            <input className="input mono" value={auth.region} onChange={(e) => setAuth({ ...auth, region: e.target.value })} placeholder="us-east-1" />
          </Field>
          <Field label="Service">
            <input className="input mono" value={auth.service} onChange={(e) => setAuth({ ...auth, service: e.target.value })} placeholder="s3 / execute-api" />
          </Field>
          <Field label="Session Token">
            <div className="input mono" style={{ display: 'flex', alignItems: 'center' }}>
              <HighlightedInput value={auth.sessionToken ?? ''} onChange={(sessionToken) => setAuth({ ...auth, sessionToken })} scope={scope} placeholder="(необязательно)" />
            </div>
          </Field>
        </>
      )}

      {auth.type === 'hawk' && (
        <>
          <Field label="Hawk Auth ID">
            <div className="input mono" style={{ display: 'flex', alignItems: 'center' }}>
              <HighlightedInput value={auth.id} onChange={(id) => setAuth({ ...auth, id })} scope={scope} placeholder="{{hawk_id}}" />
            </div>
          </Field>
          <Field label="Hawk Auth Key">
            <input className="input mono" type="password" value={auth.key} onChange={(e) => setAuth({ ...auth, key: e.target.value })} />
          </Field>
          <Field label="Algorithm">
            <Segmented
              value={auth.algorithm}
              onChange={(algorithm) => setAuth({ ...auth, algorithm })}
              options={[
                { value: 'sha256', label: 'sha256' },
                { value: 'sha1', label: 'sha1' }
              ]}
            />
          </Field>
          <Field label="Ext">
            <input className="input mono" value={auth.ext ?? ''} onChange={(e) => setAuth({ ...auth, ext: e.target.value })} placeholder="(необязательно)" />
          </Field>
        </>
      )}

      {auth.type === 'akamai' && (
        <>
          <Field label="Client Token">
            <div className="input mono" style={{ display: 'flex', alignItems: 'center' }}>
              <HighlightedInput value={auth.clientToken} onChange={(clientToken) => setAuth({ ...auth, clientToken })} scope={scope} placeholder="{{client_token}}" />
            </div>
          </Field>
          <Field label="Client Secret">
            <input className="input mono" type="password" value={auth.clientSecret} onChange={(e) => setAuth({ ...auth, clientSecret: e.target.value })} />
          </Field>
          <Field label="Access Token">
            <div className="input mono" style={{ display: 'flex', alignItems: 'center' }}>
              <HighlightedInput value={auth.accessToken} onChange={(accessToken) => setAuth({ ...auth, accessToken })} scope={scope} placeholder="{{access_token}}" />
            </div>
          </Field>
        </>
      )}

      {auth.type === 'asap' && (
        <>
          <Field label="Issuer">
            <input className="input mono" value={auth.issuer} onChange={(e) => setAuth({ ...auth, issuer: e.target.value })} />
          </Field>
          <Field label="Audience">
            <input className="input mono" value={auth.audience} onChange={(e) => setAuth({ ...auth, audience: e.target.value })} />
          </Field>
          <Field label="Key ID">
            <input className="input mono" value={auth.keyId} onChange={(e) => setAuth({ ...auth, keyId: e.target.value })} />
          </Field>
          <Field label="Private Key (PEM)">
            <textarea
              className="input mono"
              value={auth.privateKey}
              onChange={(e) => setAuth({ ...auth, privateKey: e.target.value })}
              rows={6}
              spellCheck={false}
              style={{ resize: 'vertical', minHeight: 96 }}
            />
          </Field>
          <Field label="Subject">
            <input className="input mono" value={auth.subject ?? ''} onChange={(e) => setAuth({ ...auth, subject: e.target.value })} placeholder="(необязательно)" />
          </Field>
        </>
      )}

      {auth.type === 'ntlm' && (
        <>
          <Field label="Username">
            <input className="input" value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })} placeholder="user" />
          </Field>
          <Field label="Password">
            <input className="input" type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
          </Field>
          <Field label="Domain" hint="Домен Windows (необязательно)">
            <input className="input" value={auth.domain ?? ''} onChange={(e) => setAuth({ ...auth, domain: e.target.value })} placeholder="(необязательно)" />
          </Field>
          <Field label="Workstation" hint="Имя рабочей станции (необязательно)">
            <input className="input" value={auth.workstation ?? ''} onChange={(e) => setAuth({ ...auth, workstation: e.target.value })} placeholder="(необязательно)" />
          </Field>
          <div style={{ color: 'var(--tx-3)', fontSize: 11.5, marginTop: 4 }}>
            NTLMv2: запрос отправляется с Type 1, на 401 с Type 2 движок отвечает Type 3 по тому же
            keep-alive соединению.
          </div>
        </>
      )}
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
      password: auth.password,
      code: auth.code,
      redirectUri: auth.redirectUri
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
      {auth.grant === 'authorization_code' && (
        <>
          <Field label="Authorization Code">
            <input className="input mono" value={auth.code ?? ''} onChange={(e) => setAuth({ ...auth, code: e.target.value })} placeholder="код, полученный после редиректа" />
          </Field>
          <Field label="Redirect URI">
            <input className="input mono" value={auth.redirectUri ?? ''} onChange={(e) => setAuth({ ...auth, redirectUri: e.target.value })} placeholder="https://app.example.com/callback" />
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
