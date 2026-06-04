/**
 * Escape a string so it can be embedded literally inside a `new RegExp(...)`
 * pattern. Without this, user-controlled values (variable names, path-variable
 * keys, OpenAPI server-variable names) containing regex metacharacters throw a
 * SyntaxError or match the wrong thing.
 */
export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
