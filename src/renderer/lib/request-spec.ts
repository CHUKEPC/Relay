import type { Auth, KV, RequestBody, RequestModel, RequestSettings, RequestSpec, VariableScope } from '@shared/types'
import { resolveString } from '@shared/interpolate'
import { escapeRegExp } from '@shared/regex'

function res(input: string, scope: VariableScope, unresolved: Set<string>): string {
  const r = resolveString(input ?? '', scope)
  r.unresolved.forEach((u) => unresolved.add(u))
  return r.value
}

function resolveKVs(items: KV[], scope: VariableScope, unresolved: Set<string>): KV[] {
  return items.map((i) => ({ ...i, key: res(i.key, scope, unresolved), value: res(i.value, scope, unresolved) }))
}

function resolveBody(body: RequestBody, scope: VariableScope, unresolved: Set<string>): RequestBody {
  switch (body.type) {
    case 'raw':
      return { ...body, text: res(body.text, scope, unresolved) }
    case 'urlencoded':
      return { ...body, items: resolveKVs(body.items, scope, unresolved) }
    case 'formdata':
      return {
        ...body,
        items: body.items.map((i) => ({
          ...i,
          key: res(i.key, scope, unresolved),
          value: i.type === 'text' ? res(i.value, scope, unresolved) : i.value
        }))
      }
    case 'graphql':
      return { ...body, query: res(body.query, scope, unresolved), variables: res(body.variables, scope, unresolved) }
    default:
      return body
  }
}

function resolveAuth(auth: Auth, scope: VariableScope, unresolved: Set<string>): Auth {
  switch (auth.type) {
    case 'bearer':
      return { ...auth, token: res(auth.token, scope, unresolved) }
    case 'basic':
      return { ...auth, username: res(auth.username, scope, unresolved), password: res(auth.password, scope, unresolved) }
    case 'apikey':
      return { ...auth, key: res(auth.key, scope, unresolved), value: res(auth.value, scope, unresolved) }
    case 'oauth2':
      return { ...auth, accessToken: res(auth.accessToken, scope, unresolved) }
    case 'digest':
      return { ...auth, username: res(auth.username, scope, unresolved), password: res(auth.password, scope, unresolved) }
    case 'jwt':
      return { ...auth, secret: res(auth.secret, scope, unresolved), payload: res(auth.payload, scope, unresolved) }
    case 'oauth1':
      return {
        ...auth,
        consumerKey: res(auth.consumerKey, scope, unresolved),
        consumerSecret: res(auth.consumerSecret, scope, unresolved),
        token: auth.token ? res(auth.token, scope, unresolved) : auth.token,
        tokenSecret: auth.tokenSecret ? res(auth.tokenSecret, scope, unresolved) : auth.tokenSecret
      }
    case 'aws':
      return {
        ...auth,
        accessKey: res(auth.accessKey, scope, unresolved),
        secretKey: res(auth.secretKey, scope, unresolved),
        region: res(auth.region, scope, unresolved),
        service: res(auth.service, scope, unresolved),
        sessionToken: auth.sessionToken ? res(auth.sessionToken, scope, unresolved) : auth.sessionToken
      }
    case 'hawk':
      return { ...auth, id: res(auth.id, scope, unresolved), key: res(auth.key, scope, unresolved), ext: auth.ext ? res(auth.ext, scope, unresolved) : auth.ext }
    case 'akamai':
      return {
        ...auth,
        clientToken: res(auth.clientToken, scope, unresolved),
        clientSecret: res(auth.clientSecret, scope, unresolved),
        accessToken: res(auth.accessToken, scope, unresolved)
      }
    case 'asap':
      return {
        ...auth,
        issuer: res(auth.issuer, scope, unresolved),
        audience: res(auth.audience, scope, unresolved),
        keyId: res(auth.keyId, scope, unresolved),
        privateKey: res(auth.privateKey, scope, unresolved),
        subject: auth.subject ? res(auth.subject, scope, unresolved) : auth.subject
      }
    case 'ntlm':
      return {
        ...auth,
        username: res(auth.username, scope, unresolved),
        password: res(auth.password, scope, unresolved),
        domain: auth.domain ? res(auth.domain, scope, unresolved) : auth.domain,
        workstation: auth.workstation ? res(auth.workstation, scope, unresolved) : auth.workstation
      }
    default:
      return auth
  }
}

/** Replace `:name` path segments with resolved path-variable values. */
export function applyPathVariables(url: string, pathVars: KV[], scope: VariableScope, unresolved: Set<string>): string {
  if (!pathVars.length) return url
  let out = url
  for (const pv of pathVars) {
    if (!pv.enabled || !pv.key) continue
    const value = res(pv.value, scope, unresolved)
    out = out.replace(new RegExp(`:${escapeRegExp(pv.key)}(?=/|$|\\?)`, 'g'), () => encodeURIComponent(value))
  }
  return out
}

export interface BuiltSpec {
  spec: RequestSpec
  resolvedUrl: string
  unresolved: string[]
}

export function buildRequestSpec(
  req: RequestModel,
  scope: VariableScope,
  settings: RequestSettings,
  inheritedAuth: Auth
): BuiltSpec {
  const unresolved = new Set<string>()

  let url = res(req.url, scope, unresolved)
  url = applyPathVariables(url, req.pathVariables, scope, unresolved)

  const effectiveAuth = req.auth.type === 'inherit' ? inheritedAuth : req.auth

  const spec: RequestSpec = {
    method: req.method,
    url,
    query: resolveKVs(req.query, scope, unresolved),
    headers: resolveKVs(req.headers, scope, unresolved),
    body: resolveBody(req.body, scope, unresolved),
    auth: resolveAuth(effectiveAuth, scope, unresolved),
    settings
  }

  return { spec, resolvedUrl: url, unresolved: [...unresolved] }
}
