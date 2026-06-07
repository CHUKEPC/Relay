/**
 * GraphQL schema introspection — P2.
 *
 * Runs in the Electron main process (no CORS). POSTs the standard GraphQL
 * introspection query to a user-supplied endpoint via undici, then flattens the
 * `__schema` payload into the compact `GraphqlSchema` shape the renderer uses for
 * docs + Monaco autocomplete. Restricted to http(s); all failures are returned as
 * `{ ok: false, error }` rather than thrown.
 */
import type { IpcMain } from 'electron'
import { request as undiciRequest, Agent } from 'undici'
import type { Dispatcher } from 'undici'
import { IPC } from '@shared/ipc-contract'
import type { GraphqlField, GraphqlIntrospectResult, GraphqlSchema, GraphqlTypeInfo } from '@shared/types'

/**
 * Minimal subset of the JSON shapes returned by a GraphQL introspection query.
 * We only model the fields we actually read.
 */
interface IntrospectionTypeRef {
  kind: string
  name: string | null
  ofType: IntrospectionTypeRef | null
}

interface IntrospectionInputValue {
  name: string
  type: IntrospectionTypeRef
}

interface IntrospectionField {
  name: string
  description?: string | null
  args?: IntrospectionInputValue[]
  type: IntrospectionTypeRef
}

interface IntrospectionType {
  kind: string
  name: string | null
  description?: string | null
  fields?: IntrospectionField[] | null
}

interface IntrospectionSchema {
  queryType?: { name: string } | null
  mutationType?: { name: string } | null
  subscriptionType?: { name: string } | null
  types?: IntrospectionType[] | null
}

/**
 * Render a GraphQL type reference (possibly wrapped in NonNull/List modifiers)
 * into its SDL string form, e.g. `String!`, `[User!]`, `[[Int]!]!`.
 * Exported for unit testing.
 */
export function renderTypeRef(ref: IntrospectionTypeRef | null | undefined): string {
  if (!ref) return ''
  switch (ref.kind) {
    case 'NON_NULL':
      return `${renderTypeRef(ref.ofType)}!`
    case 'LIST':
      return `[${renderTypeRef(ref.ofType)}]`
    default:
      return ref.name ?? ''
  }
}

/** The compact introspection query (no descriptions on type refs to keep it small). */
const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args { name type { ...TypeRef } }
        type { ...TypeRef }
      }
    }
  }
}
fragment TypeRef on __Type {
  kind name
  ofType { kind name
    ofType { kind name
      ofType { kind name
        ofType { kind name
          ofType { kind name
            ofType { kind name
              ofType { kind name }
            }
          }
        }
      }
    }
  }
}`

/** Flatten one introspection field into the renderer's `GraphqlField`. */
function toField(f: IntrospectionField): GraphqlField {
  return {
    name: f.name,
    type: renderTypeRef(f.type),
    args: (f.args ?? []).map((a) => ({ name: a.name, type: renderTypeRef(a.type) })),
    description: f.description ?? undefined
  }
}

/** Flatten one introspection type into the renderer's `GraphqlTypeInfo`. */
function toTypeInfo(t: IntrospectionType): GraphqlTypeInfo {
  return {
    name: t.name ?? '',
    kind: t.kind,
    description: t.description ?? undefined,
    fields: (t.fields ?? []).map(toField)
  }
}

/** Map the raw `__schema` payload into the compact `GraphqlSchema`. */
function toSchema(raw: IntrospectionSchema): GraphqlSchema {
  return {
    queryType: raw.queryType?.name ?? undefined,
    mutationType: raw.mutationType?.name ?? undefined,
    subscriptionType: raw.subscriptionType?.name ?? undefined,
    types: (raw.types ?? []).map(toTypeInfo)
  }
}

export async function introspectGraphql(
  url: string,
  headers: { key: string; value: string }[],
  rejectUnauthorized: boolean
): Promise<GraphqlIntrospectResult> {
  let dispatcher: Dispatcher | undefined
  // Bound the introspection request — a server that accepts the connection but
  // never sends a body must fail promptly, not hang up to undici's default.
  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), 30000)
  try {
    // The endpoint is reachable from the main process (no CORS, full network
    // position) — restrict to http(s) so a config can't point it at file:// or
    // other schemes.
    if (!/^https?:\/\//i.test(url ?? '')) {
      return { ok: false, error: 'GraphQL URL must be an http(s) URL' }
    }

    const reqHeaders: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json'
    }
    for (const h of headers ?? []) {
      if (h && h.key) reqHeaders[h.key] = h.value ?? ''
    }

    // Only spin up a dedicated dispatcher when we must relax TLS — the common
    // case stays on undici's shared global pool.
    if (rejectUnauthorized === false) {
      dispatcher = new Agent({ connect: { rejectUnauthorized: false } })
    }

    const res = await undiciRequest(url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify({ query: INTROSPECTION_QUERY, operationName: 'IntrospectionQuery' }),
      dispatcher,
      signal: ac.signal
    })

    const text = await res.body.text()
    let parsed: { data?: { __schema?: IntrospectionSchema }; errors?: { message?: string }[] }
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, error: `Non-JSON response (HTTP ${res.statusCode})` }
    }

    if (parsed.errors && parsed.errors.length > 0) {
      const msg = parsed.errors.map((e) => e?.message ?? 'unknown error').join('; ')
      return { ok: false, error: msg || 'GraphQL introspection returned errors' }
    }

    const rawSchema = parsed.data?.__schema
    if (!rawSchema) {
      if (res.statusCode >= 400) return { ok: false, error: `HTTP ${res.statusCode}` }
      return { ok: false, error: 'Response did not contain a GraphQL schema' }
    }

    return { ok: true, schema: toSchema(rawSchema) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timeout)
    if (dispatcher) void dispatcher.close().catch(() => {})
  }
}

export function registerGraphqlHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC.graphql.introspect,
    async (_e, url: string, headers: { key: string; value: string }[], rejectUnauthorized: boolean) =>
      introspectGraphql(url, headers, rejectUnauthorized)
  )
}
