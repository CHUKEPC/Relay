import type { RawLanguage } from '@shared/types'

/** Lines longer than this make the body editor wrap (a pasted one-line body). */
export const LONG_LINE = 120

/** True when some line of `text` is longer than `limit` characters. */
export function hasLongLine(text: string, limit = LONG_LINE): boolean {
  if (text.length <= limit) return false
  let start = 0
  while (start < text.length) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    if (end - start > limit) return true
    start = end + 1
  }
  return false
}

/**
 * Format JSON / XML bodies.
 *
 * JSON is formatted even when it is not strictly valid: `{{variables}}` written
 * without quotes (`"id": {{id}}`), stray or missing braces, comments and
 * trailing commas are all common in request bodies. Valid JSON (with the
 * variables standing in as values) is formatted by the JSON serializer; the
 * rest is re-indented by its brackets, keeping every character it had.
 */
export function beautify(text: string, language: RawLanguage): string {
  if (language === 'json') return formatJson(text)
  if (language === 'xml' || language === 'html') {
    return formatXml(text)
  }
  return text
}

export function formatJson(text: string): string {
  if (!text.trim()) return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    // not strict JSON — try with the variables masked
  }
  const masked = maskTemplates(text)
  if (masked.templates.length) {
    try {
      let out = JSON.stringify(JSON.parse(masked.text), null, 2)
      masked.templates.forEach((tpl, i) => {
        out = out.split(JSON.stringify(placeholder(masked.salt, i))).join(tpl)
      })
      return out
    } catch {
      // still not JSON — fall through to the bracket formatter
    }
  }
  return reindentJson(text)
}

/** `{{name}}` with no quotes, braces or line breaks inside: a variable, not an object. */
const TEMPLATE_BODY = /^[^{}"\n]+$/

function placeholder(salt: string, i: number): string {
  return `__relay_tpl_${salt}_${i}__`
}

/**
 * Replace every `{{variable}}` that sits outside a string by a string
 * placeholder, so the rest can be parsed as JSON. Variables inside strings are
 * already valid JSON and stay as they are.
 */
function maskTemplates(text: string): { text: string; templates: string[]; salt: string } {
  const salt = Math.random().toString(36).slice(2, 8)
  const templates: string[] = []
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      const end = stringEnd(text, i)
      out += text.slice(i, end)
      i = end
      continue
    }
    if (c === '{' && text[i + 1] === '{') {
      const close = text.indexOf('}}', i + 2)
      if (close !== -1 && TEMPLATE_BODY.test(text.slice(i + 2, close))) {
        templates.push(text.slice(i, close + 2))
        out += JSON.stringify(placeholder(salt, templates.length - 1))
        i = close + 2
        continue
      }
    }
    out += c
    i++
  }
  return { text: out, templates, salt }
}

/** Index just past the string starting at `start` (a `"`), escapes honoured; the end of text if unterminated. */
function stringEnd(text: string, start: number): number {
  let i = start + 1
  while (i < text.length) {
    if (text[i] === '\\') i += 2
    else if (text[i] === '"') return i + 1
    else i++
  }
  return text.length
}

const OPEN: Record<string, string> = { '{': '}', '[': ']' }
const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r'
/** Characters after which a dropped space would glue two words together. */
const isWordEnd = (c: string): boolean => !!c && !'{[,:\n '.includes(c)

/**
 * Re-indent JSON-like text by its brackets. Strings, `{{variables}}` and
 * comments are copied as they are; whitespace between tokens is normalised;
 * an unmatched closing bracket simply stays at the left margin. Never throws
 * and never drops a character other than layout whitespace.
 */
export function reindentJson(text: string): string {
  const INDENT = '  '
  let out = ''
  let depth = 0
  const newline = (): void => {
    out = out.replace(/[ \t]+$/, '') + '\n' + INDENT.repeat(depth)
  }
  let i = 0
  while (i < text.length) {
    const c = text[i]

    if (c === '"') {
      const end = stringEnd(text, i)
      out += text.slice(i, end)
      i = end
      continue
    }
    if (c === '{' && text[i + 1] === '{') {
      const close = text.indexOf('}}', i + 2)
      if (close !== -1 && TEMPLATE_BODY.test(text.slice(i + 2, close))) {
        out += text.slice(i, close + 2)
        i = close + 2
        continue
      }
    }
    if (c === '/' && text[i + 1] === '/') {
      let end = text.indexOf('\n', i)
      if (end === -1) end = text.length
      out += text.slice(i, end)
      i = end
      if (i < text.length) newline()
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      const end = close === -1 ? text.length : close + 2
      out += text.slice(i, end)
      i = end
      continue
    }
    if (c in OPEN) {
      // An empty pair stays on one line: {} and [].
      let j = i + 1
      while (j < text.length && isSpace(text[j])) j++
      if (text[j] === OPEN[c]) {
        out += c + OPEN[c]
        i = j + 1
        continue
      }
      out += c
      depth++
      newline()
      i++
      continue
    }
    if (c === '}' || c === ']') {
      depth = Math.max(0, depth - 1)
      if (out.trim()) newline()
      out += c
      i++
      continue
    }
    if (c === ',') {
      out = out.replace(/\s+$/, '')
      out += ','
      newline()
      i++
      continue
    }
    if (c === ':') {
      out = out.replace(/[ \t]+$/, '')
      out += ': '
      i++
      while (i < text.length && isSpace(text[i])) i++
      continue
    }
    if (isSpace(c)) {
      // Layout whitespace goes; a space that separates two words stays.
      while (i < text.length && isSpace(text[i])) i++
      const next = text[i]
      if (next && isWordEnd(out[out.length - 1] ?? '') && !'}],:'.includes(next)) out += ' '
      continue
    }
    out += c
    i++
  }
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .filter((l) => l.trim() !== '')
    .join('\n')
    .trim()
}

// HTML void elements have no closing tag — they must not increase indentation.
const VOID_ELEMENT_RE = /^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i

function formatXml(xml: string): string {
  const PADDING = '  '
  let formatted = ''
  let pad = 0
  // normalize: put each tag on its own line
  const normalized = xml.replace(/>\s*</g, '>\n<').trim()
  for (const node of normalized.split('\n')) {
    const line = node.trim()
    if (!line) continue
    if (/^<\/.+>$/.test(line)) {
      pad = Math.max(0, pad - 1)
    }
    formatted += PADDING.repeat(pad) + line + '\n'
    if (/^<[^!?][^>]*[^/]>$/.test(line) && !/^<.*<\/.*>$/.test(line) && !VOID_ELEMENT_RE.test(line)) {
      pad += 1
    }
  }
  return formatted.trim()
}
