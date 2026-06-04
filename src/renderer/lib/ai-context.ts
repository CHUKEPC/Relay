import type { AiContextSnapshot, RequestModel, ResponseResult } from '@shared/types'
import { AI_CONTEXT_BODY_LIMIT } from '@shared/constants'

export const SYSTEM_PROMPT = [
  'You are Relay, a built-in AI assistant inside a desktop API client (a Postman analog).',
  'You help the user build, debug, and test HTTP APIs.',
  'You can see a compact, secret-masked snapshot of the current request, the last response, and the active environment.',
  'Be concise and practical. Prefer concrete, copy-pasteable answers.',
  'When you produce an artifact, ALWAYS put it in a fenced code block with the right language tag:',
  '- a full HTTP request → ```http (first line "METHOD url", then headers, blank line, then body)',
  '- a Relay/Postman test → ```javascript using pm.test / pm.expect',
  '- a shell command → ```bash',
  'Never reveal or guess secret values; they are masked as "•••" in the context.'
].join('\n')

const SECRET_HEADER_RE = /^(authorization|cookie|proxy-authorization|x-api-key|api-key)$/i

function maskHeaderValue(key: string, value: string): string {
  if (SECRET_HEADER_RE.test(key)) {
    // keep a hint of the scheme (e.g. "Bearer") but mask the credential
    const m = value.match(/^(\w+)\s+/)
    return m ? `${m[1]} •••` : '•••'
  }
  return value
}

function truncate(text: string, limit = AI_CONTEXT_BODY_LIMIT): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…(truncated, ${text.length - limit} more chars)`
}

function bodySummary(req: RequestModel): string | undefined {
  const b = req.body
  switch (b.type) {
    case 'none':
      return undefined
    case 'raw':
      return truncate(b.text)
    case 'graphql':
      return truncate(`# GraphQL\n${b.query}\n# variables\n${b.variables}`)
    case 'urlencoded':
      return b.items
        .filter((i) => i.enabled)
        .map((i) => `${i.key}=${i.value}`)
        .join('&')
    case 'formdata':
      return b.items.filter((i) => i.enabled).map((i) => `${i.key}: ${i.type === 'file' ? `<file ${i.fileName ?? ''}>` : i.value}`).join('\n')
    case 'binary':
      return `<binary file ${b.fileName ?? b.filePath ?? ''}>`
  }
}

export interface SnapshotInput {
  request: RequestModel
  resolvedUrl?: string
  response?: ResponseResult
  envName?: string
  envVarNames?: string[]
}

export function buildContextSnapshot(input: SnapshotInput): AiContextSnapshot {
  const { request, response } = input
  const snapshot: AiContextSnapshot = {
    request: {
      method: request.method,
      url: request.url,
      resolvedUrl: input.resolvedUrl,
      headers: request.headers
        .filter((h) => h.enabled && h.key)
        .map((h) => ({ key: h.key, value: maskHeaderValue(h.key, h.value) })),
      bodyType: request.body.type,
      bodyPreview: bodySummary(request),
      authType: request.auth.type
    }
  }

  if (response && response.status > 0) {
    snapshot.response = {
      status: response.status,
      statusText: response.statusText,
      timeMs: response.timings.totalMs,
      sizeBytes: response.body.sizeBytes,
      headers: response.headers.slice(0, 12).map(([key, value]) => ({ key, value })),
      bodyPreview: response.body.text ? truncate(response.body.text) : response.body.isBinary ? '<binary response>' : undefined
    }
  }

  if (input.envName) {
    snapshot.environment = { name: input.envName, variableNames: input.envVarNames ?? [] }
  }

  return snapshot
}

/** Render the masked snapshot as a compact text block for the system prompt. */
export function buildContextBlock(s: AiContextSnapshot): string {
  const parts: string[] = ['## Current app context']
  if (s.request) {
    parts.push('### Request')
    parts.push(`${s.request.method} ${s.request.url}`)
    if (s.request.resolvedUrl && s.request.resolvedUrl !== s.request.url)
      parts.push(`(resolved: ${s.request.resolvedUrl})`)
    parts.push(`auth: ${s.request.authType}`)
    if (s.request.headers.length) parts.push('headers:\n' + s.request.headers.map((h) => `  ${h.key}: ${h.value}`).join('\n'))
    if (s.request.bodyPreview) parts.push(`body (${s.request.bodyType}):\n${s.request.bodyPreview}`)
  }
  if (s.response) {
    parts.push('### Last response')
    parts.push(`${s.response.status} ${s.response.statusText} · ${s.response.timeMs} ms · ${s.response.sizeBytes} bytes`)
    if (s.response.bodyPreview) parts.push(`body:\n${s.response.bodyPreview}`)
  }
  if (s.environment) {
    parts.push('### Environment')
    parts.push(`active: ${s.environment.name}`)
    if (s.environment.variableNames.length) parts.push(`variables: ${s.environment.variableNames.join(', ')}`)
  }
  return parts.join('\n')
}
