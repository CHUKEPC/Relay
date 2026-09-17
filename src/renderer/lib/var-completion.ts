/**
 * Monaco completion for `{{variables}}`.
 *
 * The request fields complete `{{` through `HighlightedInput`; the editors
 * (request body, pre-request and test scripts) get the same list from here, so
 * a variable is discoverable wherever it can be typed. One provider is
 * registered for every language, triggered by `{` and by typing inside an open
 * reference.
 */
import { monaco } from './monaco'
import { currentScope } from './request-runner'
import { useEnvironments } from '../store/environments'
import { suggestVars, varQueryAt, type VarSuggestion } from './var-suggest'

let registered = false

/** Secret variable names (active environment + globals), read at request time. */
function secretNames(): ReadonlySet<string> {
  const store = useEnvironments.getState()
  const out = new Set<string>()
  for (const v of [...(store.activeEnv()?.variables ?? []), ...store.globals.variables]) {
    if (v.secret && v.key) out.add(v.key)
  }
  return out
}

function detailOf(s: VarSuggestion): string {
  if (s.source === 'dynamic') return 'dynamic'
  if (s.secret) return `${s.source} · ••••••••`
  return s.value ? `${s.source} · ${s.value.slice(0, 60)}` : s.source
}

/** Register the `{{` completion provider exactly once. Safe to call repeatedly. */
export function ensureVarCompletion(): void {
  if (registered) return
  registered = true
  try {
    monaco.languages.registerCompletionItemProvider(
      { pattern: '**' },
      {
        // '{' opens the list at the second brace; '$' jumps straight to the
        // dynamic variables.
        triggerCharacters: ['{', '$'],
        provideCompletionItems(model, position) {
          try {
            const line = model.getLineContent(position.lineNumber)
            const caret = position.column - 1
            const q = varQueryAt(line, caret)
            if (!q) return { suggestions: [] }
            const items = suggestVars(q.query, currentScope(), { secrets: secretNames() })
            if (!items.length) return { suggestions: [] }
            const range: monaco.IRange = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              // Columns are 1-based; the offsets from varQueryAt are not.
              startColumn: q.start + 1,
              endColumn: q.end + 1
            }
            return {
              suggestions: items.map((s, i) => ({
                label: `{{${s.name}}}`,
                kind:
                  s.source === 'dynamic'
                    ? monaco.languages.CompletionItemKind.Function
                    : monaco.languages.CompletionItemKind.Variable,
                detail: detailOf(s),
                insertText: `{{${s.name}}}`,
                filterText: `{{${s.name}`,
                // Keep the order suggestVars decided (scope precedence first).
                sortText: String(i).padStart(3, '0'),
                range
              }))
            }
          } catch {
            return { suggestions: [] }
          }
        }
      }
    )
  } catch {
    registered = false
  }
}
