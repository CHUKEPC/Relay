/**
 * A small, dependency-free RFC 4180 CSV parser.
 *
 * Pure string-in / data-out: no Node or DOM APIs, so it is safe to use in any
 * process (main, preload, renderer) and trivial to unit test. Used for
 * data-driven collection runs (a CSV of variables → one iteration per row).
 *
 * Behavior summary:
 *  - Fields may be double-quoted; inside quotes `""` is a literal `"`, and
 *    commas / newlines are literal characters rather than delimiters.
 *  - Both `\n` and `\r\n` line endings are accepted (a `\r` outside a quoted
 *    field is treated as part of CRLF / swallowed).
 *  - A leading UTF-8 BOM is stripped.
 *  - A single trailing newline does NOT yield a spurious empty final row.
 *  - Completely empty lines (outside quotes) are skipped.
 *  - Malformed input never throws; it is parsed best-effort.
 */

const BOM = '﻿'

/**
 * Parse CSV text into an array of rows, each row an array of string cells.
 * Handles quoted fields, `""` escapes, embedded commas/newlines, and CRLF/LF.
 */
export function parseCsvRows(text: string): string[][] {
  if (typeof text !== 'string' || text.length === 0) return []

  // Strip a leading UTF-8 BOM if present.
  const input = text.charCodeAt(0) === 0xfeff || text.startsWith(BOM) ? text.slice(1) : text

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  // Tracks whether the current row has had any content/structure at all, so we
  // can distinguish a genuinely empty line from a row that contains empty cells.
  let rowHasContent = false

  const len = input.length

  const pushField = (): void => {
    row.push(field)
    field = ''
  }

  const pushRow = (): void => {
    pushField()
    // Skip rows that are completely empty (a single empty cell and no other
    // structure) — these come from blank lines. Rows with real cells, even if
    // those cells are empty strings (e.g. ",,"), are kept.
    const isBlank = row.length === 1 && row[0] === '' && !rowHasContent
    if (!isBlank) rows.push(row)
    row = []
    rowHasContent = false
  }

  for (let i = 0; i < len; i++) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        // Look ahead: a doubled quote is an escaped literal quote.
        if (input[i + 1] === '"') {
          field += '"'
          i++ // consume the second quote
        } else {
          inQuotes = false // closing quote
        }
      } else {
        field += ch
      }
      continue
    }

    // Not inside quotes.
    if (ch === '"') {
      // Opening quote of a quoted field. Any text already accumulated in the
      // field (malformed CSV like `ab"c"`) is preserved best-effort.
      inQuotes = true
      rowHasContent = true
      continue
    }

    if (ch === ',') {
      rowHasContent = true
      pushField()
      continue
    }

    if (ch === '\n') {
      pushRow()
      continue
    }

    if (ch === '\r') {
      // CRLF: swallow the \r and let the following \n end the row. A lone \r is
      // treated as a line ending too, for robustness.
      if (input[i + 1] === '\n') {
        i++ // consume the \n as well
      }
      pushRow()
      continue
    }

    // Ordinary character.
    field += ch
    rowHasContent = true
  }

  // Flush whatever remains. If we ended exactly on a newline, `field` is '' and
  // `row` is empty, so a trailing newline does not create an empty row. If the
  // file ends without a newline mid-field (including unterminated quotes), we
  // still emit the partial row best-effort.
  if (inQuotes || field !== '' || row.length > 0) {
    pushRow()
  }

  return rows
}

/**
 * Parse CSV with a header row into objects keyed by column name.
 *
 * The first non-empty row provides the (trimmed) header names. Each subsequent
 * row becomes an object mapping header → cell value. Missing trailing cells map
 * to `''`; cells beyond the header count are ignored. Empty input → `[]`.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return []

  const headers = rows[0].map((h) => h.trim())
  const out: Record<string, string>[] = []

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]
    const obj: Record<string, string> = {}
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c]
      if (key === '') continue // ignore unnamed columns
      obj[key] = c < cells.length ? cells[c] : ''
    }
    out.push(obj)
  }

  return out
}
