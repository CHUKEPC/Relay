# AI_ASSISTANT.md — the built-in multi-provider AI assistant

This is the product's signature differentiator. The user connects **their own** API key for any
supported provider and gets an assistant **inside** the app that understands the current request,
response, and environment, and can help build and debug APIs.

All AI calls run in the **main process** (Node). Because we are not in a browser, there are **no
CORS issues** and no need for any "browser access" override headers.

## Supported providers

A single normalized chat interface, with per-provider adapters. The user can register multiple
provider profiles and switch the active provider/model from the AI panel.

### 1) OpenAI (ChatGPT)
- Endpoint: `POST https://api.openai.com/v1/chat/completions`
- Headers: `Authorization: Bearer <API_KEY>`, `Content-Type: application/json`
- Body: `{ "model": "...", "messages": [...], "stream": true, "temperature": ... }`
- Streaming: SSE; each `data:` line is JSON with `choices[0].delta.content`. Terminates on
  `data: [DONE]`.
- Models: `GET https://api.openai.com/v1/models`.

### 2) Anthropic (Claude)
- Endpoint: `POST https://api.anthropic.com/v1/messages`
- Headers: `x-api-key: <API_KEY>`, `anthropic-version: 2023-06-01`, `Content-Type: application/json`
- Body: `{ "model": "...", "max_tokens": N, "system": "...", "messages": [{role, content}], "stream": true }`
  - Note: Anthropic takes the system prompt as a top-level `system` field (not a message), roles are
    `user`/`assistant` only, and `max_tokens` is **required**.
- Streaming: SSE with typed events; accumulate text from `content_block_delta` events where
  `delta.type === "text_delta"` (`delta.text`). Handle `message_start`, `content_block_start`,
  `content_block_stop`, `message_delta`, `message_stop`.
- Default models to surface: latest Claude family (e.g. Opus/Sonnet/Haiku). Keep the model list
  editable by the user since names change over time.

### 3) OpenRouter
- Endpoint: `POST https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible schema)
- Headers: `Authorization: Bearer <API_KEY>`, optional `HTTP-Referer` and `X-Title` for app
  attribution.
- Models: `GET https://openrouter.ai/api/v1/models` — populate the model picker dynamically.

### 4) Custom OpenAI-compatible (local & others)
- A configurable **base URL** (e.g. `http://localhost:11434/v1` for Ollama,
  `http://localhost:1234/v1` for LM Studio, Groq, Together, etc.).
- Same request/streaming shape as OpenAI. Optional/blank API key for local servers.

## Normalized interface

```ts
type Role = 'system' | 'user' | 'assistant' | 'tool'
interface ChatMessage { role: Role; content: string; toolCalls?: ToolCall[]; toolCallId?: string }

interface ProviderConfig {
  id: string
  kind: 'openai' | 'anthropic' | 'openrouter' | 'openai-compatible'
  label: string
  baseUrl?: string          // for openai-compatible / overrides
  apiKeyRef?: string        // ref into safeStorage; NEVER the raw key
  defaultModel: string
  extraHeaders?: Record<string, string>
}

// main process:
async function* streamChat(provider, model, messages, opts): AsyncIterable<Delta>
//   Delta = { type: 'text', text } | { type: 'tool_call', call } | { type: 'done' } | { type: 'error', error }
```

The adapter layer converts this normalized form to each provider's wire format and back, so the UI
and the rest of the app never branch on provider.

## Context injection (what makes it useful)

Before sending the user's message, the assistant is given a compact, structured **context block**
(as a system message, or as the leading user context) describing the app state:

- Active request: method, URL (with variables shown both raw and resolved-but-secrets-masked),
  headers, body type + a truncated body, auth type.
- Last response (if any): status, time, size, truncated body (pretty-printed, capped to a token
  budget, e.g. first ~4–8 KB), key response headers.
- Active environment name and **non-secret** variable names (mask secret values).
- Optionally the surrounding collection structure (names only) for "where to save" type tasks.

Rules:
- **Never** put raw secret values (API keys, passwords, tokens) into the prompt. Mask them.
- Cap large bodies; tell the model they were truncated.
- Keep a token budget; drop oldest context first.

## Core use-cases (P0)

- **Explain this response** — summarize status/shape/likely meaning; spot errors.
- **Generate a request** from a natural-language description (method, URL, headers, body).
- **Fix this error** — given a 4xx/5xx or a network error, propose concrete changes.
- **Write a test** — produce a `pm.test(...)` snippet for the current response.
- **Convert** — to cURL or another language.
- Free-form chat about APIs, with the app context available.

Each assistant message that contains an actionable artifact (a request, a header set, a script)
gets an **"Apply"** affordance that writes it into the current request/tab.

## Tool-calling (P1 — the assistant can *act*)

Define a small toolset the model can call (OpenAI/OpenRouter `tools`, Anthropic `tools`). Execute
in main, return results, loop until the model produces a final answer.

Suggested tools:
- `get_current_request()` / `get_last_response()` — read app state.
- `update_current_request({ method?, url?, headers?, body?, auth? })` — mutate the open request.
- `create_request({ collectionId?, name, ...spec })` — add a request to a collection.
- `set_variable({ scope, key, value })` — set env/global variable.
- `send_request({ requestId? })` — actually fire a request.

**Safety**: mutating/sending tools require **explicit user confirmation** in the UI before they
execute (a diff/preview + Approve/Reject), unless the user has enabled an "auto-apply" toggle.
Never let the assistant exfiltrate secrets; tools return masked values for secret fields.

## Security & privacy

- API keys stored via Electron `safeStorage`; only the main process ever decrypts them.
- The renderer references providers by `id`/`apiKeyRef`, never by raw key.
- No telemetry. The only outbound traffic is (a) the user's own API requests and (b) the user's
  own AI provider calls.
- Make it obvious in Settings which provider/endpoint a key is sent to (especially for the custom
  base URL case).
