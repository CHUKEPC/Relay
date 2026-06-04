# ARCHITECTURE.md

## Process model (Electron)

Three contexts, strict separation:

- **main** (Node.js): app lifecycle, windows, the HTTP request engine, the AI provider client,
  storage/repositories, secret storage, and all IPC handlers. This is where network calls happen —
  **no browser CORS applies here**, which is the whole reason we use Electron.
- **preload**: the only bridge. Uses `contextBridge.exposeInMainWorld('api', …)` to expose a
  **typed, minimal** surface to the renderer. No raw `ipcRenderer`, no Node globals leak.
- **renderer** (React): pure UI. Talks to main exclusively through `window.api`.

Security baseline (non-negotiable): `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true` where feasible, `webSecurity: true`. Remote content is never loaded into the main
window; the only "remote" things are (a) outbound API calls from main and (b) sandboxed response
**preview** rendered in an isolated `<webview>`/`<iframe sandbox>` with scripts disabled.

```
┌─────────────┐  window.api (typed)   ┌──────────────┐   IPC    ┌──────────────────────┐
│  renderer   │ ───────────────────►  │   preload    │ ───────► │        main          │
│  (React UI) │ ◄───────────────────  │ contextBridge│ ◄─────── │ http · ai · storage  │
└─────────────┘   events / responses  └──────────────┘          └──────────────────────┘
                                                                  outbound HTTPS (no CORS)
```

## IPC contract

Defined once in `src/shared/ipc-contract.ts` and consumed by preload + main + renderer. Channels
(illustrative — finalize during build):

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `request:send` | renderer→main (req/res) | run an HTTP request; returns `ResponseResult` |
| `request:cancel` | renderer→main | cancel an in-flight request by id |
| `request:stream` | main→renderer (events) | optional streaming/progress chunks |
| `ai:chat` | renderer→main, **streaming** | run an AI completion; emits delta events |
| `ai:cancel` | renderer→main | cancel an AI stream |
| `ai:listModels` | renderer→main | list models for a provider |
| `secrets:set` / `secrets:get` / `secrets:delete` | renderer→main | encrypted API keys via safeStorage (renderer only handles key *refs*, never raw values back) |
| `storage:load` / `storage:save` | renderer→main | collections, environments, history, tabs, settings |
| `data:import` / `data:export` | renderer→main | Postman/OpenAPI/cURL import, collection export |
| `app:dialog` | renderer→main | native open/save dialogs for files |

Streaming pattern: renderer calls `ai:chat` with a `streamId`; main emits
`ai:chat:delta:<streamId>` events and a terminal `ai:chat:done` / `ai:chat:error`. Same idea may
be used for large HTTP downloads.

## HTTP engine (`src/main/http`)

Pure, testable core. Signature:

```ts
runRequest(spec: RequestSpec, opts: RunOptions): Promise<ResponseResult>
```

- **Input `RequestSpec`** (already variable-interpolated by the time it reaches main, OR main does
  interpolation given an env snapshot — pick one and be consistent; recommended: renderer sends the
  raw request + resolved variable map, main interpolates so secrets never round-trip to renderer).
  Fields: method, url, query params, headers, body (typed union: none/raw/urlencoded/formdata/
  binary/graphql), auth, settings (timeout, followRedirects, rejectUnauthorized).
- **Engine**: Node `undici`/`fetch` (or `axios`) with:
  - `AbortController` for cancellation/timeout.
  - manual redirect handling when needed (to record the chain) — or `redirect: 'follow'` with a cap.
  - `multipart/form-data` built with `FormData`/streams; file fields read from disk paths.
  - TLS: honor `rejectUnauthorized` (SSL verification toggle).
  - **Timing**: capture start → DNS/connect/TTFB → end; report total ms (best-effort breakdown).
  - **Size**: bytes of response body + headers.
  - cookie jar (P1) using `tough-cookie`.
- **Output `ResponseResult`**: status, statusText, headers (array of pairs), body (text + detected
  contentType + base64 for binary), timings, size, redirects, error (structured) if any.

## AI client (`src/main/ai`)

Provider-agnostic. A `Provider` adapter normalizes everything to a streaming chat interface:

```ts
interface Provider {
  id: string
  chat(messages: ChatMessage[], opts): AsyncIterable<Delta>   // yields text deltas (+ tool calls)
  listModels?(): Promise<ModelInfo[]>
}
```

Adapters: `openai`, `anthropic`, `openrouter`, `openai-compatible` (custom base URL: Ollama, LM
Studio, etc.). Streaming is SSE parsed in main and forwarded to the renderer as IPC events. See
[`AI_ASSISTANT.md`](AI_ASSISTANT.md) for the exact request/response shapes and tool-calling.

API keys are read from `safeStorage` inside main only. They are **never** sent to the renderer and
**never** logged.

## Storage (`src/main/storage`)

Local-first, **no native modules**:

- `electron-store` for `settings.json` (theme, defaults, provider configs *without* secrets).
- A small **repository layer** writing JSON documents under `app.getPath('userData')`:
  - `collections.json`, `environments.json`, `globals.json`, `history.json`, `tabs.json`.
  - In-memory model + **debounced** atomic writes (write to temp, rename) to avoid corruption.
- **Secrets** (AI keys, request auth secrets) via Electron `safeStorage` → encrypted blobs keyed by
  a stable ref id; only ciphertext touches disk.
- Schema/versioning: each document carries a `version`; include a forward-compatible migration hook.

> SQLite (`better-sqlite3`) is a documented future upgrade. It is intentionally **not** used now
> because native module rebuilds reduce one-shot build reliability.

## Renderer state (`src/renderer/store`, Zustand)

Suggested slices: `requestStore` (open tabs + active request draft), `collectionsStore`,
`environmentsStore`, `historyStore`, `responseStore`, `aiStore`, `settingsStore`, `uiStore`
(theme, panel layout). Persistence is delegated to main via IPC, not kept only in `localStorage`.

## Variable interpolation

A single resolver used everywhere: given a string and a merged variable scope (collection → env →
global, with `{{var}}` syntax and a few built-ins like `{{$guid}}`, `{{$timestamp}}`,
`{{$randomInt}}`), return the resolved string and a list of unresolved names for UI flagging.

## Scripting sandbox (P1)

Pre-request/test scripts run in main in an **isolated** context (Node `vm` with a frozen,
allow-listed `pm` object — no `require`, no `process`, no fs). Expose `pm.environment`, `pm.globals`,
`pm.variables`, `pm.request`, `pm.response`, `pm.test`, `pm.expect`. Capture `console.log` and test
results and return them to the renderer.

## Theming

CSS variables in `:root` and `.dark`, seeded from `design/tokens`. Tailwind reads them via
`theme.extend.colors` referencing the variables. Theme choice persisted in settings; `system` mode
follows `nativeTheme`.

## Packaging

`electron-builder` config (`electron-builder.yml`): `win` → `nsis`; `mac` → `dmg` + `zip`
(hardened runtime entitlements stubbed); `linux` → `AppImage` + `deb`. App icon sourced from
`design/assets`. `npm run build:{win,mac,linux}` wraps it.
