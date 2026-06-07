/**
 * Monaco completion provider for the GraphQL query editor.
 *
 * A single provider is registered for the `graphql` language. It pulls
 * suggestions from whatever schema is currently active (set via
 * `setGraphqlSchema`). It is intentionally defensive: with no schema it returns
 * no suggestions and never throws, so the editor keeps working before/without an
 * introspection.
 */
import { monaco } from './monaco'
import type { GraphqlSchema, GraphqlTypeInfo } from '@shared/types'

/** The schema the provider should suggest from (null = no suggestions). */
let activeSchema: GraphqlSchema | null = null
let registered = false

/** Set (or clear) the schema used by the GraphQL completion provider. */
export function setGraphqlSchema(schema: GraphqlSchema | null): void {
  activeSchema = schema
}

function typeByName(schema: GraphqlSchema, name?: string): GraphqlTypeInfo | undefined {
  if (!name) return undefined
  return schema.types.find((t) => t.name === name)
}

/** Collect suggestion items (deduped by label) from the active schema. */
function buildSuggestions(
  schema: GraphqlSchema,
  range: monaco.IRange
): monaco.languages.CompletionItem[] {
  const items: monaco.languages.CompletionItem[] = []
  const seen = new Set<string>()

  const push = (
    label: string,
    kind: monaco.languages.CompletionItemKind,
    detail?: string,
    documentation?: string
  ): void => {
    if (!label || seen.has(label)) return
    seen.add(label)
    items.push({ label, kind, detail, documentation, insertText: label, range })
  }

  // Root-type fields (Query / Mutation / Subscription) are the most useful at
  // the top level of a query/mutation.
  for (const rootName of [schema.queryType, schema.mutationType, schema.subscriptionType]) {
    const root = typeByName(schema, rootName)
    if (!root) continue
    for (const f of root.fields) {
      push(f.name, monaco.languages.CompletionItemKind.Field, f.type, f.description)
    }
  }

  // Fields of any object/interface type — useful inside selection sets.
  for (const t of schema.types) {
    if (t.name.startsWith('__')) continue
    for (const f of t.fields) {
      push(f.name, monaco.languages.CompletionItemKind.Field, f.type, f.description)
    }
  }

  // Type names (skip introspection internals).
  for (const t of schema.types) {
    if (t.name.startsWith('__')) continue
    push(t.name, monaco.languages.CompletionItemKind.Class, t.kind, t.description)
  }

  return items
}

/**
 * Register the GraphQL completion provider exactly once. Safe to call repeatedly.
 * Returns immediately on subsequent calls.
 */
export function ensureGraphqlCompletion(): void {
  if (registered) return
  registered = true
  try {
    monaco.languages.registerCompletionItemProvider('graphql', {
      provideCompletionItems(model, position) {
        if (!activeSchema) return { suggestions: [] }
        const word = model.getWordUntilPosition(position)
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }
        try {
          return { suggestions: buildSuggestions(activeSchema, range) }
        } catch {
          return { suggestions: [] }
        }
      }
    })
  } catch {
    // Monaco may not have a 'graphql' language registered in some environments;
    // never let completion setup break the editor.
    registered = false
  }
}
