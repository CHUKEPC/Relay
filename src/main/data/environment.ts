/**
 * Postman environment / globals import.
 *
 * A Postman environment export looks like:
 *   { "name": "My env",
 *     "values": [{ "key": "base_url", "value": "...", "enabled": true, "type": "default"|"secret" }],
 *     "_postman_variable_scope": "environment" }
 *
 * The same shape (with `_postman_variable_scope: "globals"`) is used for the
 * globals export, which we also import as an Environment named "Globals".
 */
import { makeId } from '@shared/id'
import type { Environment, VariableDef } from '@shared/types'

/** Heuristic: does this object look like a Postman environment/globals export? */
export function isPostmanEnvironment(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false
  // The canonical marker; accept both environment and globals scopes.
  if (obj._postman_variable_scope === 'environment' || obj._postman_variable_scope === 'globals') {
    return Array.isArray(obj.values)
  }
  // Fallback for hand-written/older exports: a `values[]` of {key,value}
  // entries plus a `name`, and crucially NO collection `item[]` (which would
  // make it a collection) and no spec markers.
  if (Array.isArray(obj.values) && typeof obj.name === 'string' && !obj.item && !obj.openapi && !obj.swagger) {
    return obj.values.every((v: any) => v && typeof v === 'object' && 'key' in v)
  }
  return false
}

export function importPostmanEnvironment(obj: any): Environment {
  const scope = obj._postman_variable_scope
  const variables: VariableDef[] = (obj.values ?? [])
    .filter((v: any) => v && typeof v === 'object')
    .map((v: any) => ({
      id: makeId('var'),
      key: v.key ?? '',
      value: v.value == null ? '' : String(v.value),
      // Postman marks disabled vars with enabled:false; absent means enabled.
      enabled: v.enabled !== false,
      // `type: "secret"` flags a masked value.
      secret: v.type === 'secret' || v.secret === true
    }))
  return {
    id: makeId('env'),
    name: obj.name ?? (scope === 'globals' ? 'Globals' : 'Imported environment'),
    variables
  }
}
