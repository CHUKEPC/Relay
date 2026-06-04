import type { RawLanguage } from '@shared/types'

/** Format JSON / XML bodies. Falls back to the original text on parse errors. */
export function beautify(text: string, language: RawLanguage): string {
  if (language === 'json') {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }
  if (language === 'xml' || language === 'html') {
    return formatXml(text)
  }
  return text
}

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
    if (/^<[^!?][^>]*[^/]>$/.test(line) && !/^<.*<\/.*>$/.test(line)) {
      pad += 1
    }
  }
  return formatted.trim()
}
