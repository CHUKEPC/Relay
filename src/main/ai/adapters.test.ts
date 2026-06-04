/**
 * Fully offline tests for the AI adapters. A fake `fetch` returns a Response
 * whose body is a ReadableStream emitting the supplied SSE byte chunks. By
 * splitting a sample stream across several chunks (sometimes mid-line) we also
 * exercise the SSE line-buffering across chunk boundaries.
 */
import { describe, it, expect } from 'vitest'
import type { AiStreamEvent, ChatMessage, ToolSpec } from '@shared/types'
import {
  listModels,
  streamChat,
  toAnthropicMessages,
  toAnthropicTools,
  toOpenAiMessages,
  toOpenAiTools,
  type ResolvedProvider
} from './adapters'

/* ============================================================
 * Test helpers
 * ============================================================ */

const encoder = new TextEncoder()

/** A fake `fetch` that streams the given chunks as the response body. */
function fakeFetch(
  chunks: string[],
  init: { ok?: boolean; status?: number; bodyText?: string } = {}
): { impl: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const ok = init.ok ?? true
  const status = init.status ?? 200

  const impl = (async (input: RequestInfo | URL, requestInit?: RequestInit) => {
    calls.push({ url: String(input), init: requestInit })

    if (!ok) {
      return new Response(init.bodyText ?? '', { status })
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      }
    })
    // `Response` constructed from a ReadableStream gives us `.body` + `.ok`.
    return new Response(stream, { status: 200 })
  }) as unknown as typeof fetch

  return { impl, calls }
}

/** A fake `fetch` for JSON GET endpoints (model listing). */
function fakeJsonFetch(json: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(json), {
      status: ok ? 200 : status,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch
}

async function collect(gen: AsyncGenerator<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const out: AiStreamEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

function textOf(events: AiStreamEvent[]): string {
  return events
    .filter((e): e is { type: 'text'; text: string } => e.type === 'text')
    .map((e) => e.text)
    .join('')
}

function toolCallsOf(events: AiStreamEvent[]) {
  return events
    .filter((e): e is { type: 'tool_call'; call: { id: string; name: string; arguments: string } } =>
      e.type === 'tool_call'
    )
    .map((e) => e.call)
}

const OPENAI: ResolvedProvider = { kind: 'openai', apiKey: 'sk-test' }
const OPENROUTER: ResolvedProvider = { kind: 'openrouter', apiKey: 'sk-or' }
const LOCAL: ResolvedProvider = { kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1/' }
const ANTHROPIC: ResolvedProvider = { kind: 'anthropic', apiKey: 'sk-ant' }

/* ============================================================
 * OpenAI-style streaming
 * ============================================================ */

describe('OpenAI streaming', () => {
  it('concatenates delta content and terminates on [DONE]', async () => {
    const { impl, calls } = fakeFetch([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":", "}}]}\n\n',
      // Split a single SSE line across two chunks to test buffering.
      'data: {"choices":[{"delta":{"con',
      'tent":"world"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n'
    ])

    const events = await collect(
      streamChat(OPENAI, 'gpt-4o', [{ role: 'user', content: 'hi' }], { fetchImpl: impl })
    )

    expect(textOf(events)).toBe('Hello, world')
    const last = events.at(-1)
    expect(last).toEqual({ type: 'done', finishReason: 'stop' })
    expect(toolCallsOf(events)).toHaveLength(0)

    // Verify the request shape (URL, auth header, streamed body).
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.stream).toBe(true)
    expect(body.model).toBe('gpt-4o')
  })

  it('accumulates a tool call split across chunks', async () => {
    const { impl } = fakeFetch([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"weather","arguments":"{\\"ci"}}]}}]}\n\n',
      // mid-line split in the arguments fragment
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"argum',
      'ents":"ty\\":\\"Paris\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n'
    ])

    const tools: ToolSpec[] = [
      { name: 'get_weather', description: 'Get weather', parameters: { type: 'object' } }
    ]
    const events = await collect(
      streamChat(OPENAI, 'gpt-4o', [{ role: 'user', content: 'weather in Paris?' }], {
        tools,
        fetchImpl: impl
      })
    )

    const calls = toolCallsOf(events)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      id: 'call_1',
      name: 'get_weather',
      arguments: '{"city":"Paris"}'
    })
    expect(JSON.parse(calls[0].arguments)).toEqual({ city: 'Paris' })
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'tool_calls' })
  })

  it('accumulates two parallel tool calls by index', async () => {
    const { impl } = fakeFetch([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"f0","arguments":"{}"}},{"index":1,"id":"b","function":{"name":"f1","arguments":"{}"}}]}}]}\n\n',
      'data: [DONE]\n\n'
    ])
    const events = await collect(
      streamChat(OPENAI, 'gpt-4o', [{ role: 'user', content: 'x' }], { fetchImpl: impl })
    )
    const calls = toolCallsOf(events)
    expect(calls.map((c) => c.name)).toEqual(['f0', 'f1'])
    expect(calls.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('emits an error event on HTTP 401 with the provider message', async () => {
    const { impl } = fakeFetch([], {
      ok: false,
      status: 401,
      bodyText: JSON.stringify({ error: { message: 'Invalid API key' } })
    })
    const events = await collect(
      streamChat(OPENAI, 'gpt-4o', [{ role: 'user', content: 'hi' }], { fetchImpl: impl })
    )
    expect(events).toEqual([{ type: 'error', error: '401 Invalid API key' }])
  })

  it('uses the OpenRouter default base URL and forwards extra headers', async () => {
    const provider: ResolvedProvider = {
      ...OPENROUTER,
      extraHeaders: { 'HTTP-Referer': 'https://relay.app', 'X-Title': 'Relay' }
    }
    const { impl, calls } = fakeFetch(['data: [DONE]\n\n'])
    await collect(
      streamChat(provider, 'openai/gpt-4o', [{ role: 'user', content: 'hi' }], {
        fetchImpl: impl
      })
    )
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['HTTP-Referer']).toBe('https://relay.app')
    expect(headers['X-Title']).toBe('Relay')
    expect(headers.Authorization).toBe('Bearer sk-or')
  })

  it('omits Authorization for a keyless local server and trims trailing slash', async () => {
    const { impl, calls } = fakeFetch(['data: [DONE]\n\n'])
    await collect(
      streamChat(LOCAL, 'llama3', [{ role: 'user', content: 'hi' }], { fetchImpl: impl })
    )
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions')
    const headers = calls[0].init?.headers as Record<string, string>
    expect('Authorization' in headers).toBe(false)
  })

  it('errors when openai-compatible has no baseUrl', async () => {
    const { impl } = fakeFetch(['data: [DONE]\n\n'])
    const events = await collect(
      streamChat({ kind: 'openai-compatible' }, 'm', [{ role: 'user', content: 'hi' }], {
        fetchImpl: impl
      })
    )
    expect(events[0].type).toBe('error')
  })
})

/* ============================================================
 * Anthropic streaming
 * ============================================================ */

describe('Anthropic streaming', () => {
  it('accumulates text_delta blocks and terminates on message_stop', async () => {
    const { impl, calls } = fakeFetch([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
      // Split an event across chunks (header in one, data in the next).
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo!"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ])

    const events = await collect(
      streamChat(ANTHROPIC, 'claude-sonnet-4-6', [{ role: 'user', content: 'hi' }], {
        fetchImpl: impl
      })
    )

    expect(textOf(events)).toBe('Hello!')
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'end_turn' })

    // Verify the Anthropic request shape.
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.max_tokens).toBe(1024)
    expect(body.stream).toBe(true)
  })

  it('ignores ping events', async () => {
    const { impl } = fakeFetch([
      'event: ping\ndata: {"type":"ping"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ])
    const events = await collect(
      streamChat(ANTHROPIC, 'claude-haiku-4-5', [{ role: 'user', content: 'hi' }], {
        fetchImpl: impl
      })
    )
    expect(textOf(events)).toBe('ok')
  })

  it('accumulates a tool_use block from input_json_delta fragments', async () => {
    const { impl } = fakeFetch([
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"ci"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ty\\":\\"Paris\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ])
    const events = await collect(
      streamChat(ANTHROPIC, 'claude-opus-4-6', [{ role: 'user', content: 'weather?' }], {
        tools: [{ name: 'get_weather', description: 'w', parameters: { type: 'object' } }],
        fetchImpl: impl
      })
    )
    const calls = toolCallsOf(events)
    expect(calls).toHaveLength(1)
    expect(calls[0].id).toBe('toolu_1')
    expect(calls[0].name).toBe('get_weather')
    expect(JSON.parse(calls[0].arguments)).toEqual({ city: 'Paris' })
    expect(events.at(-1)?.type).toBe('done')
  })

  it('emits an error event on HTTP 400', async () => {
    const { impl } = fakeFetch([], {
      ok: false,
      status: 400,
      bodyText: JSON.stringify({ error: { message: 'bad request' } })
    })
    const events = await collect(
      streamChat(ANTHROPIC, 'claude-opus-4-6', [{ role: 'user', content: 'hi' }], {
        fetchImpl: impl
      })
    )
    expect(events).toEqual([{ type: 'error', error: '400 bad request' }])
  })
})

/* ============================================================
 * Cancellation
 * ============================================================ */

describe('cancellation', () => {
  it('returns silently (no error event) when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const failingFetch = (async () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch

    const events = await collect(
      streamChat(OPENAI, 'gpt-4o', [{ role: 'user', content: 'hi' }], {
        signal: controller.signal,
        fetchImpl: failingFetch
      })
    )
    expect(events).toEqual([])
  })
})

/* ============================================================
 * Message converters
 * ============================================================ */

describe('OpenAI message conversion', () => {
  it('maps assistant tool calls and tool results', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'weather?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' }]
      },
      { role: 'tool', content: '{"temp":20}', toolCallId: 'call_1', name: 'get_weather' }
    ]
    const wire = toOpenAiMessages(messages)

    expect(wire[0]).toEqual({ role: 'system', content: 'be terse' })
    expect(wire[1]).toEqual({ role: 'user', content: 'weather?' })

    const assistant = wire[2] as { role: string; content: string | null; tool_calls: unknown[] }
    expect(assistant.role).toBe('assistant')
    expect(assistant.content).toBeNull()
    expect(assistant.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }
    ])

    const toolMsg = wire[3] as { role: string; content: string; tool_call_id: string; name?: string }
    expect(toolMsg.role).toBe('tool')
    expect(toolMsg.tool_call_id).toBe('call_1')
    expect(toolMsg.content).toBe('{"temp":20}')
    expect(toolMsg.name).toBe('get_weather')
  })

  it('maps ToolSpec[] to OpenAI tools', () => {
    const tools: ToolSpec[] = [
      { name: 'set_variable', description: 'set var', parameters: { type: 'object', properties: {} } }
    ]
    expect(toOpenAiTools(tools)).toEqual([
      {
        type: 'function',
        function: { name: 'set_variable', description: 'set var', parameters: { type: 'object', properties: {} } }
      }
    ])
  })
})

describe('Anthropic message conversion', () => {
  it('extracts system messages into a top-level system string', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'context block' },
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ]
    const { system, messages: out } = toAnthropicMessages(messages)
    expect(system).toBe('context block\n\nrules')
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' }
    ])
  })

  it('maps assistant tool calls to tool_use and tool results to tool_result', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'let me check',
        toolCalls: [{ id: 'toolu_1', name: 'get_weather', arguments: '{"city":"Paris"}' }]
      },
      { role: 'tool', content: '{"temp":20}', toolCallId: 'toolu_1' }
    ]
    const { messages: out } = toAnthropicMessages(messages)

    expect(out[0]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'let me check' },
        { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }
      ]
    })
    expect(out[1]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"temp":20}' }]
    })
  })

  it('maps ToolSpec[] to Anthropic input_schema tools', () => {
    const tools: ToolSpec[] = [
      { name: 'send_request', description: 'fire it', parameters: { type: 'object' } }
    ]
    expect(toAnthropicTools(tools)).toEqual([
      { name: 'send_request', description: 'fire it', input_schema: { type: 'object' } }
    ])
  })
})

/* ============================================================
 * Model listing
 * ============================================================ */

describe('listModels', () => {
  it('maps OpenAI /models data[].id', async () => {
    const impl = fakeJsonFetch({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] })
    const models = await listModels(OPENAI, impl)
    expect(models).toEqual([{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }])
  })

  it('returns a static Claude list for Anthropic without hitting the network', async () => {
    let called = false
    const impl = (async () => {
      called = true
      return new Response('{}')
    }) as unknown as typeof fetch
    const models = await listModels(ANTHROPIC, impl)
    expect(called).toBe(false)
    expect(models.map((m) => m.id)).toContain('claude-opus-4-6')
  })

  it('returns [] on a failing models request', async () => {
    const impl = fakeJsonFetch({}, false, 500)
    expect(await listModels(OPENAI, impl)).toEqual([])
  })
})
