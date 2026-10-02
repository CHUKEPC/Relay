/**
 * Schema helpers shared by the OpenAPI 3.x and Swagger 2.0 importers: both
 * documents point into themselves with `$ref` and describe bodies with JSON
 * Schema, only the paths differ (components/schemas vs definitions).
 */

/** HTTP methods an OpenAPI / Swagger path item can declare. */
export const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

/** Follow `$ref` pointers (`#/components/...`, `#/definitions/...`) to the real node. */
export function resolveRef(doc: any, node: any, depth = 0): any {
  if (!node || depth > 20) return node
  if (node.$ref && typeof node.$ref === 'string') {
    const path = node.$ref.replace(/^#\//, '').split('/')
    let cur = doc
    for (const seg of path) cur = cur?.[seg]
    return resolveRef(doc, cur, depth + 1)
  }
  return node
}

/** Build a sample JSON value from a schema: example, default, first enum value, or a typed placeholder. */
export function sampleFromSchema(doc: any, schema: any, depth = 0): unknown {
  schema = resolveRef(doc, schema, depth)
  if (!schema || depth > 8) return null
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  const type = schema.type ?? (schema.properties ? 'object' : undefined)
  switch (type) {
    case 'object': {
      // Null-prototype so a schema property literally named `__proto__` is stored
      // as an own key (and round-trips) instead of reassigning the object's prototype.
      const out: Record<string, unknown> = Object.create(null)
      const props = schema.properties ?? {}
      for (const [k, v] of Object.entries(props)) out[k] = sampleFromSchema(doc, v, depth + 1)
      return out
    }
    case 'array':
      return [sampleFromSchema(doc, schema.items, depth + 1)]
    case 'string':
      return schema.format === 'date-time' ? new Date(0).toISOString() : 'string'
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return true
    default:
      return null
  }
}
