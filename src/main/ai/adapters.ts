/**
 * Pure, provider-agnostic AI adapters.
 *
 * This module has NO `electron` import on purpose: it is fully unit-testable
 * by injecting a fake `fetch` (`opts.fetchImpl`). It converts our normalized
 * `ChatMessage[]` into each provider's wire format, parses the provider's SSE
 * stream, and yields a single normalized `AiStreamEvent` sequence. The rest of
 * the app (and the renderer) never branches on provider.
 *
 * Secret resolution (safeStorage) happens in the IPC layer (`./index.ts`): the
 * resolved `apiKey` is passed in here so these functions stay pure.
 */
import type {
  AiStreamEvent,
  ChatMessage,
  ModelInfo,
  ProviderKind,
  ToolCall,
  ToolSpec
} from '@shared/types'

/* ============================================================
 * Resolved provider (internal) — key already decrypted by caller
 * ============================================================ */

export interface ResolvedProvider {
  kind: ProviderKind
  /** required for openai-compatible; optional override for the others */
  baseUrl?: string
  /** decrypted key; omit/empty for keyless local servers */
  apiKey?: string
  /** e.g. OpenRouter HTTP-Referer / X-Title */
  extraHeaders?: Record<string, string>
}

export interface StreamChatOptions {
  tools?: ToolSpec[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
  /** injectable for tests; defaults to global fetch */
  fetchImpl?: typeof fetch
}

/** Anthropic requires max_tokens; this is our default when the caller omits it. */
const DEFAULT_ANTHROPIC_MAX_TOKENS = 1024
const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_API = 'https://api.anthropic.com/v1'

/** Static Claude list (Anthropic's list endpoint differs; keep editable). */
const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
]

/* ============================================================
 * Small helpers
 * ============================================================ */

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Resolve the OpenAI-style base URL (already without a trailing slash). */
function resolveOpenAiBaseUrl(p: ResolvedProvider): string {
  let base: string | undefined
  switch (p.kind) {
    case 'openai':
      base = p.baseUrl || 'https://api.openai.com/v1'
      break
    case 'openrouter':
      base = p.baseUrl || 'https://openrouter.ai/api/v1'
      break
    case 'openai-compatible':
      base = p.baseUrl
      break
    default:
      base = p.baseUrl
  }
  if (!base) {
    throw new Error('openai-compatible provider requires a baseUrl')
  }
  return trimTrailingSlash(base)
}

function isOpenAiStyle(kind: ProviderKind): boolean {
  return kind === 'openai' || kind === 'openrouter' || kind === 'openai-compatible'
}

/** True only when an explicit AbortSignal fired (caller cancelled). */
function isAbort(signal: AbortSignal | undefined, err: unknown): boolean {
  if (signal?.aborted) return true
  if (err && typeof err === 'object' && 'name' in err) {
    return (err as { name?: string }).name === 'AbortError'
  }
  return false
}

/* ============================================================
 * SSE readers
 * ============================================================ */

/**
 * Decode a `ReadableStream<Uint8Array>` into text and split it into SSE lines,
 * robustly buffering across chunk boundaries. Yields one line at a time
 * (without the trailing newline). A blank line (event separator) is yielded as
 * an empty string so callers can detect event boundaries if needed.
 */
async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // `stream: true` keeps multi-byte chars intact across chunk boundaries.
      buffer += decoder.decode(value, { stream: true })
      // Normalize CRLF so we only split on \n.
      buffer = buffer.replace(/\r\n/g, '\n')
      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        yield line
      }
    }
    // Flush any trailing decoded bytes and a final line without a newline.
    buffer += decoder.decode()
    if (buffer.length > 0) {
      for (const line of buffer.split('\n')) yield line
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * OpenAI-style SSE: every interesting line looks like `data: {json}` (the colon
 * may or may not be followed by a space). Yields the raw payload string after
 * `data:`. The caller is responsible for `[DONE]` handling and JSON parsing.
 */
async function* parseOpenAiSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  for await (const line of readLines(body)) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice('data:'.length).trimStart()
    if (payload.length === 0) continue
    yield payload
  }
}

/**
 * Anthropic SSE: typed events arrive as a `event: <name>` line followed by a
 * `data: {json}` line, separated by a blank line. We pair them up and yield
 * `{ event, data }`. If a `data:` arrives without a preceding `event:` we fall
 * back to the JSON's own `type` field (Anthropic includes it).
 */
async function* parseAnthropicSSE(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<{ event: string; data: string }> {
  let currentEvent = ''
  for await (const line of readLines(body)) {
    if (line.startsWith('event:')) {
      currentEvent = line.slice('event:'.length).trim()
      continue
    }
    if (line.startsWith('data:')) {
      const data = line.slice('data:'.length).trimStart()
      if (data.length === 0) continue
      let evt = currentEvent
      if (!evt) {
        // Recover the event name from the JSON body if no `event:` line was sent.
        try {
          const parsed = JSON.parse(data) as { type?: string }
          if (parsed.type) evt = parsed.type
        } catch {
          /* ignore — yield with empty event name */
        }
      }
      yield { event: evt, data }
      currentEvent = ''
      continue
    }
    // Blank line = end of an SSE event; reset the pending event name.
    if (line.length === 0) currentEvent = ''
  }
}

/* ============================================================
 * Message converters — exported for tests
 * ============================================================ */

interface OpenAiToolCallWire {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAiMessageWire {
  role: ChatMessage['role']
  content: string | null
  tool_calls?: OpenAiToolCallWire[]
  tool_call_id?: string
  name?: string
}

/** Map our normalized messages to OpenAI chat-completions wire format. */
export function toOpenAiMessages(messages: ChatMessage[]): OpenAiMessageWire[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      // Tool results: role 'tool' with the originating tool_call_id.
      return {
        role: 'tool',
        content: m.content ?? '',
        tool_call_id: m.toolCallId,
        ...(m.name ? { name: m.name } : {})
      }
    }
    const wire: OpenAiMessageWire = {
      role: m.role,
      content: m.content ?? ''
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      wire.tool_calls = m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments }
      }))
      // OpenAI allows content to be null when only tool calls are present.
      if (!m.content) wire.content = null
    }
    return wire
  })
}

/** Map our ToolSpec[] to OpenAI's `tools` array. */
export function toOpenAiTools(tools: ToolSpec[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }))
}

interface AnthropicTextBlock {
  type: 'text'
  text: string
}
interface AnthropicToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}
interface AnthropicToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock

interface AnthropicMessageWire {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicConverted {
  system?: string
  messages: AnthropicMessageWire[]
}

/**
 * Convert normalized messages to Anthropic's shape:
 * - all `system` messages are pulled into a top-level `system` string (joined),
 * - only `user`/`assistant` remain in `messages`,
 * - `tool` results become a user message with a `tool_result` content block,
 * - assistant `toolCalls` become assistant `tool_use` content blocks.
 */
export function toAnthropicMessages(messages: ChatMessage[]): AnthropicConverted {
  const systemParts: string[] = []
  const out: AnthropicMessageWire[] = []

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content) systemParts.push(m.content)
      continue
    }
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content ?? ''
          }
        ]
      })
      continue
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: AnthropicContentBlock[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const c of m.toolCalls) {
        let input: unknown = {}
        try {
          input = c.arguments ? JSON.parse(c.arguments) : {}
        } catch {
          input = {}
        }
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input })
      }
      out.push({ role: 'assistant', content: blocks })
      continue
    }
    // Plain user/assistant text message.
    out.push({ role: m.role as 'user' | 'assistant', content: m.content ?? '' })
  }

  const result: AnthropicConverted = { messages: out }
  if (systemParts.length > 0) result.system = systemParts.join('\n\n')
  return result
}

/** Map our ToolSpec[] to Anthropic's `tools` array. */
export function toAnthropicTools(tools: ToolSpec[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters
  }))
}

/* ============================================================
 * Tool-call accumulators (OpenAI streaming deltas come in by index)
 * ============================================================ */

interface OpenAiDeltaToolCall {
  index: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: OpenAiDeltaToolCall[] }
    finish_reason?: string | null
  }>
}

/* ============================================================
 * streamChat — the one normalized streaming entry point
 * ============================================================ */

export async function* streamChat(
  p: ResolvedProvider,
  model: string,
  messages: ChatMessage[],
  opts: StreamChatOptions = {}
): AsyncGenerator<AiStreamEvent> {
  const fetchImpl = opts.fetchImpl ?? fetch
  if (p.kind === 'anthropic') {
    yield* streamAnthropic(p, model, messages, opts, fetchImpl)
  } else if (isOpenAiStyle(p.kind)) {
    yield* streamOpenAi(p, model, messages, opts, fetchImpl)
  } else {
    yield { type: 'error', error: `Unsupported provider kind: ${String(p.kind)}` }
  }
}

async function* streamOpenAi(
  p: ResolvedProvider,
  model: string,
  messages: ChatMessage[],
  opts: StreamChatOptions,
  fetchImpl: typeof fetch
): AsyncGenerator<AiStreamEvent> {
  let url: string
  try {
    url = `${resolveOpenAiBaseUrl(p)}/chat/completions`
  } catch (err) {
    yield { type: 'error', error: (err as Error).message }
    return
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(p.extraHeaders ?? {})
  }
  // Omit Authorization for keyless local servers (e.g. Ollama).
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`

  const body: Record<string, unknown> = {
    model,
    messages: toOpenAiMessages(messages),
    stream: true
  }
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature
  if (typeof opts.maxTokens === 'number') body.max_tokens = opts.maxTokens
  if (opts.tools && opts.tools.length > 0) {
    body.tools = toOpenAiTools(opts.tools)
    body.tool_choice = 'auto'
  }

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal
    })
  } catch (err) {
    if (isAbort(opts.signal, err)) return
    yield { type: 'error', error: `Request failed: ${(err as Error).message}` }
    return
  }

  if (!res.ok) {
    const text = await safeReadText(res)
    yield { type: 'error', error: formatHttpError(res.status, text) }
    return
  }
  if (!res.body) {
    yield { type: 'error', error: 'Empty response body from provider' }
    return
  }

  // Accumulate streamed tool calls keyed by their `index`.
  const toolAcc = new Map<number, { id: string; name: string; arguments: string }>()
  let finishReason: string | undefined

  try {
    for await (const payload of parseOpenAiSSE(res.body)) {
      if (payload === '[DONE]') break
      let chunk: OpenAiStreamChunk
      try {
        chunk = JSON.parse(payload) as OpenAiStreamChunk
      } catch {
        continue // ignore keep-alive / malformed fragments
      }
      const choice = chunk.choices?.[0]
      if (!choice) continue

      const content = choice.delta?.content
      if (typeof content === 'string' && content.length > 0) {
        yield { type: 'text', text: content }
      }

      const deltaCalls = choice.delta?.tool_calls
      if (deltaCalls) {
        for (const dc of deltaCalls) {
          const idx = dc.index ?? 0
          const acc = toolAcc.get(idx) ?? { id: '', name: '', arguments: '' }
          if (dc.id) acc.id = dc.id
          if (dc.function?.name) acc.name += dc.function.name
          if (dc.function?.arguments) acc.arguments += dc.function.arguments
          toolAcc.set(idx, acc)
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason
    }
  } catch (err) {
    if (isAbort(opts.signal, err)) return
    yield { type: 'error', error: `Stream error: ${(err as Error).message}` }
    return
  }

  // Emit a normalized tool_call for each fully-accumulated call, in index order.
  for (const idx of [...toolAcc.keys()].sort((a, b) => a - b)) {
    const acc = toolAcc.get(idx)!
    const call: ToolCall = {
      id: acc.id || `call_${idx}`,
      name: acc.name,
      arguments: acc.arguments || '{}'
    }
    yield { type: 'tool_call', call }
  }

  yield { type: 'done', finishReason }
}

interface AnthropicEvent {
  type?: string
  index?: number
  delta?: {
    type?: string
    text?: string
    partial_json?: string
    stop_reason?: string | null
  }
  content_block?: { type?: string; id?: string; name?: string }
}

async function* streamAnthropic(
  p: ResolvedProvider,
  model: string,
  messages: ChatMessage[],
  opts: StreamChatOptions,
  fetchImpl: typeof fetch
): AsyncGenerator<AiStreamEvent> {
  const url = `${ANTHROPIC_API}/messages`
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    ...(p.extraHeaders ?? {})
  }
  if (p.apiKey) headers['x-api-key'] = p.apiKey

  const { system, messages: anthropicMessages } = toAnthropicMessages(messages)
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
    messages: anthropicMessages,
    stream: true
  }
  if (system) body.system = system
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature
  if (opts.tools && opts.tools.length > 0) body.tools = toAnthropicTools(opts.tools)

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal
    })
  } catch (err) {
    if (isAbort(opts.signal, err)) return
    yield { type: 'error', error: `Request failed: ${(err as Error).message}` }
    return
  }

  if (!res.ok) {
    const text = await safeReadText(res)
    yield { type: 'error', error: formatHttpError(res.status, text) }
    return
  }
  if (!res.body) {
    yield { type: 'error', error: 'Empty response body from provider' }
    return
  }

  // Track tool_use blocks by their content-block index while their input JSON
  // streams in as `input_json_delta` fragments.
  const blocks = new Map<number, { id: string; name: string; json: string }>()
  let finishReason: string | undefined

  try {
    for await (const { event, data } of parseAnthropicSSE(res.body)) {
      if (event === 'ping') continue
      let evt: AnthropicEvent
      try {
        evt = JSON.parse(data) as AnthropicEvent
      } catch {
        continue
      }
      const kind = event || evt.type

      switch (kind) {
        case 'content_block_start': {
          const cb = evt.content_block
          if (cb?.type === 'tool_use' && typeof evt.index === 'number') {
            blocks.set(evt.index, { id: cb.id ?? '', name: cb.name ?? '', json: '' })
          }
          break
        }
        case 'content_block_delta': {
          const d = evt.delta
          if (d?.type === 'text_delta' && typeof d.text === 'string') {
            if (d.text.length > 0) yield { type: 'text', text: d.text }
          } else if (d?.type === 'input_json_delta' && typeof d.partial_json === 'string') {
            if (typeof evt.index === 'number') {
              const b = blocks.get(evt.index)
              if (b) b.json += d.partial_json
            }
          }
          break
        }
        case 'content_block_stop': {
          if (typeof evt.index === 'number') {
            const b = blocks.get(evt.index)
            if (b) {
              const call: ToolCall = {
                id: b.id || `toolu_${evt.index}`,
                name: b.name,
                arguments: b.json.length > 0 ? b.json : '{}'
              }
              yield { type: 'tool_call', call }
              blocks.delete(evt.index)
            }
          }
          break
        }
        case 'message_delta': {
          if (evt.delta?.stop_reason) finishReason = evt.delta.stop_reason
          break
        }
        case 'message_stop': {
          yield { type: 'done', finishReason }
          return
        }
        // message_start and anything else: ignore.
        default:
          break
      }
    }
  } catch (err) {
    if (isAbort(opts.signal, err)) return
    yield { type: 'error', error: `Stream error: ${(err as Error).message}` }
    return
  }

  // Stream ended without an explicit message_stop — still emit a terminal done.
  yield { type: 'done', finishReason }
}

/* ============================================================
 * Error formatting
 * ============================================================ */

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

/**
 * Build a compact "<status> <message>" string. Tries to extract a provider
 * error message from common JSON shapes; falls back to the raw/empty body.
 */
function formatHttpError(status: number, bodyText: string): string {
  let message = bodyText
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText) as {
        error?: { message?: string } | string
        message?: string
      }
      if (parsed && typeof parsed.error === 'object' && parsed.error?.message) {
        message = parsed.error.message
      } else if (typeof parsed.error === 'string') {
        message = parsed.error
      } else if (parsed.message) {
        message = parsed.message
      }
    } catch {
      /* keep raw text */
    }
  }
  const trimmed = (message || '').trim()
  return trimmed ? `${status} ${trimmed}` : `HTTP ${status}`
}

/* ============================================================
 * Model listing
 * ============================================================ */

interface OpenAiModelsResponse {
  data?: Array<{ id: string }>
}

export async function listModels(
  p: ResolvedProvider,
  fetchImpl: typeof fetch = fetch
): Promise<ModelInfo[]> {
  if (p.kind === 'anthropic') {
    // Anthropic's model endpoint differs; return a curated static list.
    return [...ANTHROPIC_MODELS]
  }

  let url: string
  try {
    url = `${resolveOpenAiBaseUrl(p)}/models`
  } catch {
    return []
  }

  const headers: Record<string, string> = { ...(p.extraHeaders ?? {}) }
  if (p.apiKey) headers.Authorization = `Bearer ${p.apiKey}`

  try {
    const res = await fetchImpl(url, { method: 'GET', headers })
    if (!res.ok) return []
    const json = (await res.json()) as OpenAiModelsResponse
    const data = json.data ?? []
    return data
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => ({ id: m.id }))
  } catch {
    return []
  }
}
