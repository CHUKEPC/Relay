# ARCHITECTURE.md

*[Русская версия](ARCHITECTURE.ru.md)*

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

- The in-house **`JsonStore`** (`src/main/storage/json-store.ts`) writes one JSON document per key
  under `app.getPath('userData')/relay-data`:
  - app-level: `settings`, `providers`, `plugins`, `features`, `userThemes`;
  - per workspace (`ws/<id>/`): `collections`, `environments`, `globals`, `history`, `tabs`, `cookies`.
  - In-memory model + **debounced** atomic writes (write to temp, rename). A document that fails to
    parse is moved aside as `<key>.json.corrupt-<ts>` before anything is written over it, and every
    workspace folder keeps a `workspace.json` so a damaged workspace list can be rebuilt.
- **Secrets** (AI keys, request auth secrets) via Electron `safeStorage` → encrypted blobs keyed by
  a stable ref id; only ciphertext touches disk.
- Schema/versioning: each document carries a `version`; include a forward-compatible migration hook.

> SQLite exists only as a backup/export format, through pure-WASM `sql.js` (`src/main/sqlite`).
> Native modules such as `better-sqlite3` stay off-limits: rebuilds reduce build reliability.
>
> Every restore path (JSON, ZIP, SQLite) passes what it read through the acceptors in
> `src/shared/backup-shape.ts`, so a foreign or hand-edited file can never replace the workspace
> with objects the UI cannot render.

## Renderer state (`src/renderer/store`, Zustand)

Suggested slices: `requestStore` (open tabs + active request draft), `collectionsStore`,
`environmentsStore`, `historyStore`, `responseStore`, `aiStore`, `settingsStore`, `uiStore`
(theme, panel layout). Persistence is delegated to main via IPC, not kept only in `localStorage`.

## Keyboard shortcuts (`src/renderer/lib/keymap.ts`)

One table (`KEY_ACTIONS`) owns every action, its label and its default combo; user overrides live in
`SettingsDoc.keybindings` (`''` disables an action). Combos resolve from the PHYSICAL key (`e.code`)
so they survive a non-Latin layout, and both windows listen in the **capture phase** — Monaco, Radix
dialogs and plain inputs all stop keydown before it reaches `window`, which otherwise made a
shortcut work only while focus happened to sit on the page background. Three consequences worth
keeping in mind:

- The Shortcuts screen sets `setRecordingShortcut(true)` while it records, or the app would run the
  very shortcut being rebound.
- AltGr (reported as Ctrl+Alt on the layouts that have it) is ignored only for a target that takes
  typed text, so `Ctrl+Alt+<key>` stays available as a shortcut everywhere else.
- **`Ctrl+Alt+<digit>` is not a usable default.** Measured with real key injection on Windows 11:
  `Ctrl+Alt+1/2/3` never reach the window at all (resident software registers them system-wide),
  while `Ctrl+Alt+4/8/9` do — and on a Russian layout `Ctrl+Alt+8` also types `₽`, because Windows
  hands Ctrl+Alt to the layout as AltGr. The pane presets therefore sit on `Ctrl+Shift+<digit>` and
  the splits on `Ctrl+\` / `Ctrl+Shift+\`, all of which were verified to arrive with `e.code`
  intact on a Cyrillic layout. A shortcut swallowed by another program cannot be recovered from
  inside the app; every pane action is also reachable from the pane menu, and the FAQ says so.

The default Electron menu is removed in main (`Menu.setApplicationMenu(null)`): it is invisible in a
frameless window, but its accelerators ran first — Ctrl+W closed the window instead of the tab.
The Help screen and the tour render their key hints from the same table, so they cannot go stale.

## Variable interpolation

A single resolver used everywhere: given a string and a merged variable scope (collection → env →
global, with `{{var}}` syntax and a few built-ins like `{{$guid}}`, `{{$timestamp}}`,
`{{$randomInt}}`), return the resolved string and a list of unresolved names for UI flagging.

## Scripting sandbox (P1)

Pre-request/test scripts run in an **isolated child process** in a Node `vm` context with a frozen,
allow-listed `pm` object — no `require`, no `process`, no fs. Expose `pm.environment`, `pm.globals`,
`pm.variables`, `pm.request`, `pm.response`, `pm.test`, `pm.expect`. Capture `console.log` and test
results and return them to the renderer.

The children (both the script sandbox and the plugin sandbox) run **their own bundle**,
`out/main/sandbox.js` from `src/main/sandbox-entry.ts`, resolved at runtime by
`src/main/sandbox-path.ts`. They must not run the app's main bundle: a child is the Electron binary
with `ELECTRON_RUN_AS_NODE=1`, where the built-in `electron` module does not exist, so the main
bundle's top-level `require('electron')` throws. In development that require resolves anyway —
the `electron` npm package is on disk — which is why forking the main bundle appeared to work while
EVERY script and EVERY plugin in a packaged build died instantly with «Script sandbox stopped».
The sandbox entry pulls in the two hosts and nothing that touches Electron (the `electron` imports
in that module graph are all `import type`); a build that regresses this shows up as
`require("electron")` inside `out/main/chunks/*`.

A child that finishes a run cleanly is kept **warm** for the next script (`keepWarm`), because
forking Electron-as-Node costs a few hundred milliseconds of CPU and a collection run pays it twice
per request. A child is retired instead of reused when its run timed out, crashed, or left async
work in flight.

## Isolation

Relay opens no connection the user did not ask for. What enforces it:

- **No background network work.** There is no automatic update check (`src/main/update` runs only
  from the About button), no telemetry, no crash reporter.
- **CSP** on every response of the default session (`contentSecurityPolicy()` in `src/main/index.ts`):
  `img-src 'self' data: blob:`, `connect-src 'self'` and so on. It is applied to the `file://`
  page too (verified), so neither the UI nor the HTML response preview can load a remote resource.
- **Session hardening** (`isolateSession()`): spellchecker off (it would download dictionaries),
  every permission request declined except clipboard read/write, and `--dns-prefetch-disable`.
- **Outbound traffic has an owner**: the HTTP engine, realtime/gRPC clients, the OAuth token and
  browser sign-in (a loopback listener that exists only while the user signs in), the AI client
  (only with the AI pack) and plugins holding the `net` permission.

## Dockable panels (`src/renderer/lib/dock.tsx`)

The sidebar, the response panel and the request console share one dock model: `left | right |
bottom | float`. `useDockDrag` turns a press on a panel header into a drag session: edge zones of
the container dock the panel, the middle makes it float, and a floating panel follows the cursor.
The sidebar's position lives in the UI store (localStorage); the response panel's is per pane
(`PaneLeaf.respDock` / `respFloat`, migrated from the 1.2 `layout` field). Panels that render a
status bar get their controls through `PaneDockContext` instead of props.

## Low-power mode

`SettingsDoc.lowPowerMode` is read by main before the app is ready (`lowPowerRequested()`), because
the GPU decision cannot change later: hardware acceleration off, software compositing, Chromium's
low-end-device mode, no smooth scrolling. The renderer marks `<html data-low-power>` at hydrate;
`styles/low-power.css` drops animation, blur and shadows, and `CodeEditor` renders
`CodeEditorPlain` (a textarea with the same `{{` autocomplete from `lib/var-suggest.ts`), so the
Monaco chunk and its workers are never loaded.

## Theming

CSS variables in `:root` and `.dark`, seeded from `design/tokens`. Tailwind reads them via
`theme.extend.colors` referencing the variables. Theme choice persisted in settings; `system` mode
follows `nativeTheme`.

## Packaging

`electron-builder` config (`electron-builder.yml`): `win` → `nsis`; `mac` → `dmg` + `zip`
(hardened runtime entitlements stubbed); `linux` → `AppImage` + `deb`. App icon sourced from
`design/assets`. `npm run build:{win,mac,linux}` wraps it.
