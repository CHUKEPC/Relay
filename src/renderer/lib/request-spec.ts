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
