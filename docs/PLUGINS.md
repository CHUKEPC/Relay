# Relay Plugin System

> Status: **v1 + P1 + P2 — implemented**. On top of v1/P1 (buttons, themes, request/response
> hooks, panels, storage, secret config, per-host net editor, apiVersion): command-palette
> commands, `clipboard` + `history:read` permissions, `workspace`/`collection` events,
> bounded sandbox timers, interactive panels (null-origin iframe + postMessage), i18n label
> overrides, and install-from-`.zip` (size-bounded; installs start disabled). Only a hosted,
> signed registry remains deferred (it needs distribution infrastructure, not app code).

The goal is the "Minecraft mods" experience: a user drops a folder into the plugins
directory and gets new buttons, themes and automation — **without forking the app and
without weakening the Electron security baseline** (`contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, no raw Node/`ipcRenderer` anywhere near
third-party code).

---

## 1. Design principles

1. **Plugin code never runs in the renderer.** The renderer renders only *declarative*
   contributions (buttons, themes) read from the manifest. All plugin JavaScript executes
   in an isolated child process in the main-process world — the same hardened model the
   `pm.*` script sandbox already uses (`src/main/scripting/`).
2. **Capabilities, not ambient authority.** A plugin gets exactly the API surface its
   *granted* permissions allow. No permission → the call throws. There is no `require`,
   no `process`, no Electron, no IPC inside the sandbox (only bounded `setTimeout`).
3. **Declarative-first.** Everything the UI needs at render time (buttons, themes, config
   schema) lives in `plugin.json`. Code is only invoked on *events* (a button click, a
   completed response), so the app never executes plugin code just to draw the screen.
4. **Fail closed.** If the sandbox child cannot be forked, or code-generation
   restrictions are not in effect, the event is dropped with an error — plugin code is
   never executed with weaker isolation.
5. **The user is the gatekeeper.** Permissions are shown as plain-Russian consequence
   lines in «Плагины» and granted explicitly when the user enables a plugin. If a plugin
   update asks for *more* permissions, it is disabled until re-approved.

---

## 2. Architecture

```
┌────────────────────────── renderer (sandboxed, no Node) ──────────────────────────┐
│  PluginsSection («Плагины»)      ResponsePanel toolbar          Theme engine      │
│  enable/grant/config/delete UI   declarative plugin buttons     plugin themes     │
└─────────────△──────────────────────────△──────────────────────────△──────────────┘
              │ window.api.plugins* (typed IPC, preload contextBridge)
┌─────────────▽──────────────────────────▽─────────────────────────────────────────┐
│ main: PluginManager (src/main/plugins/)                                          │
│  • scans <userData>/relay-data/plugins/*/plugin.json (symlink-confined)          │
│  • validates manifests, merges enable/grant/config state (storage key `plugins`) │
│  • fs.watch hot reload → broadcasts `plugins:event {type:'changed'}`             │
│  • redacts + grant-filters event context, dispatches to the sandbox host         │
└─────────────┬─────────────────────────────────────────────────────────────────────┘
              │ fork() per event — RELAY_PLUGIN_SANDBOX=1, ELECTRON_RUN_AS_NODE=1,
              │ --disallow-code-generation-from-strings, hard wall-clock timeout
┌─────────────▽─────────────────────────────────────────────────────────────────────┐
│ plugin sandbox child (src/main/plugins/sandbox.ts)                                │
│  • node:vm context, codeGeneration disabled, frozen `relay` API                   │
│  • capability-gated: relay.fetch only with `net`, context only with *:read       │
│  • returns { logs, toast, error } — plain JSON only                              │
└───────────────────────────────────────────────────────────────────────────────────┘
```

One child per event, exactly like the `pm.*` sandbox: a hung or crashed plugin affects
only its own event, never the app or a concurrent run.

---

## 3. Plugin anatomy

Plugins live under the app's data directory:

```
<userData>/relay-data/plugins/
└── webhook-forwarder/          # folder name MUST equal manifest "id"
    ├── plugin.json             # manifest (required, ≤ 64 KB)
    └── main.js                 # handlers (required for code plugins, ≤ 512 KB)
```

A theme-only plugin may omit `main.js` entirely. Symlinked plugin files are rejected,
and every read is confined to the plugins folder (realpath-checked).

### 3.1 Manifest (`plugin.json`)

```json
{
  "id": "webhook-forwarder",
  "name": "Webhook Forwarder",
  "version": "1.0.0",
  "description": "Posts the current response to a configurable webhook.",
  "author": "you",
  "main": "main.js",
  "permissions": ["net", "request:read", "response:read"],
  "contributes": {
    "buttons": [
      {
        "id": "post-webhook",
        "label": "В webhook",
        "icon": "upload",
        "location": "response-toolbar",
        "tooltip": "Отправить этот ответ в webhook"
      }
    ],
    "themes": [],
    "events": []
  },
  "config": [
    { "key": "webhookUrl", "label": "Webhook URL", "type": "string", "placeholder": "https://hooks.example.com/…" }
  ]
}
```

| Field | Required | Rules |
|-------|----------|-------|
| `id` | yes | `^[a-z0-9][a-z0-9-]{1,63}$`, **must equal the folder name** (prevents id spoofing; also makes duplicate ids impossible) |
| `name` | yes | non-empty, ≤ 100 chars |
| `version` | yes | `x.y.z`-style string |
| `description`, `author` | no | strings, ≤ 500 / 100 chars |
| `main` | no | plain `.js` file name inside the plugin folder (no separators, no `..`); default `main.js` |
| `permissions` | no | array drawn from §4; unknown permission ⇒ manifest rejected |
| `contributes.buttons` | no | ≤ 10; `id` slug, `label` ≤ 40 chars, `location` from §6.1. `icon` is a Relay icon name — an unknown icon does NOT fail validation, it falls back to the default glyph |
| `contributes.panels` | no | ≤ 10; `{ id, label, icon?, location: 'response-tab', interactive? }` — a tab rendering sandboxed HTML (§6.3) |
| `contributes.commands` | no | ≤ 20; `{ id, title, icon? }` — entries in the command palette (Cmd/Ctrl+K), run the `command:<id>` handler |
| `contributes.themes` | no | ≤ 10; `{ id, label, base: 'light'\|'dark', vars }`, ≤ 60 vars each. Keys must be `--`-prefixed; **values must match a color/number allowlist** (hex, `rgb()/hsl()/oklch()/…`, keywords, simple lengths) — anything else (e.g. `url(...)`) is dropped (§8) |
| `contributes.events` | no | array drawn from §5.2 (`response`, `request`, `workspace`, `collection`); `request` additionally requires the `request:write` permission |
| `apiVersion` | no | positive integer ≤ the app's `PLUGIN_API_VERSION` (currently 1); a higher value fails closed so old apps reject future plugins |
| `config` | no | ≤ 20 fields; `{ key, label, type: 'string'\|'secret', placeholder?, description? }`. `secret` values are safeStorage-backed (set via «Плагины» → `setSecret`), never stored in the doc or sent to the renderer in plaintext |
| `i18n` | no | `{ locale: { key: value } }`; a label/title/description written as `%key%` is replaced with the value for the app locale (default `ru`) |

Validation failures never crash the app: a broken plugin appears in «Плагины» with the
error text and cannot be enabled.

### 3.2 Handler module (`main.js`)

A plain script evaluated once per event inside the sandbox. It registers handlers via
the global `relay`:

```js
relay.on('button:post-webhook', async (ctx) => {
  const url = relay.config.webhookUrl
  if (!url) return relay.toast('Укажите Webhook URL в настройках плагина', 'error')
  if (!ctx.response) return relay.toast('Сначала отправьте запрос', 'error')

  const res = await relay.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request: ctx.request,                  // requires request:read
      status: ctx.response.status,           // requires response:read
      body: ctx.response.bodyText
    })
  })
  relay.toast(res.ok ? `Отправлено (${res.status})` : `Webhook ответил ${res.status}`, res.ok ? 'ok' : 'error')
})
```

Authoring contract:

- **No state survives between events** — each dispatch is a fresh process. For persistent
  state use the `storage` permission (`relay.storage.*`, a plugin-scoped KV store).
- **Handler return values are reserved** (future request-patch semantics). Return
  `undefined`; anything else logs a warning on the plugin card.
- **Button dispatch precedence**: the specific `button:<id>` handler wins; the generic
  `button` handler runs only when no specific one is registered.
- A rejection of the promise *returned* by a handler becomes the run's error; detached
  floating promises are not tracked.

---

## 4. Permission model

Permissions are declared in the manifest and **granted by the user** when enabling the
plugin. Grants are persisted in the app-level storage document `plugins.json` next to
enable state and config values.

| Permission | UI copy (RU) | Grants | Notes |
|------------|--------------|--------|-------|
| `net` | «Доступ в интернет — любой хост» | `relay.fetch` to any host | all-or-nothing **and redirect-transparent by design**; 10 s per call, ≤ 5 calls/event, 1 MB response cap, ≤ 5 redirect hops |
| `net:<host>` | «Доступ в интернет — только `<host>`» | `relay.fetch` restricted to that host (exact or `*.suffix`, optionally `:port` — compared against the effective port, so `net:example.com:443` matches `https://example.com/`) | repeatable; enforced on **every redirect hop**, not just the entry URL; plain `net` lifts the restriction |
| `request:read` | «Чтение запроса (секретные заголовки скрыты)» | redacted request snapshot in event context | header values matching the engine's `CREDENTIAL_HEADER_RE` are masked; URL userinfo stripped and **all** query-param values masked (keys kept) |
| `response:read` | «Чтение ответа (тело до 200 КБ)» | response snapshot in event context | status, headers (same masking), text body capped at 200 KB, timings, size |
| `request:write` | «Изменение запроса перед отправкой» | `relay.request.*` in a `request` handler | header ops are by name (set/remove) + url/method; required to declare the `request` event |
| `storage` | «Своё хранилище данных» | `relay.storage.*` (plugin-scoped KV) | snapshot in / mutations out; ≤ 100 keys, ≤ 8 KB/value; persisted OUTSIDE the plugin folder |
| `clipboard` | «Запись в буфер обмена» | `relay.clipboard.writeText` | text the plugin asks to copy is written by main (≤ 100 KB) |
| `history:read` | «Чтение истории запросов» | recent history in `ctx.history` | newest first, ≤ 25 entries, URLs redacted (query values masked) |

Secret config (`type: 'secret'`) is safeStorage-backed: values are written via
«Плагины» → `setSecret`, stored under `plugin:<id>:<key>`, never sent to the renderer in
plaintext, and injected into `relay.config` only inside the sandbox at dispatch.

Grant lifecycle:

- **Enable = grant.** Toggling a plugin on records `granted = manifest.permissions` at
  that moment. The toggle is labeled «Включить и разрешить» when permissions are listed.
- **Permission escalation ⇒ re-approval.** On every dispatch the manager recomputes
  `manifest.permissions ⊆ granted`. If a hot-reloaded manifest asks for more, the plugin
  is disabled and the card shows the **diff of newly requested permissions** until the
  user re-enables it.
- **Folder deletion revokes activation.** A state entry whose folder vanished is set to
  `enabled: false, granted: []` (config preserved) — a same-id reinstall starts disabled
  and must be re-approved. *Disable* keeps grants+config; *«Удалить»* (uninstall) removes
  the folder and purges the entry.
- **Per-host net narrowing.** For a plugin granted broad `net`, the «Плагины» card has a
  host-allowlist editor; a non-empty allowlist replaces `net` with exactly those
  `net:<host>` entries at dispatch time (a strict narrowing — it never widens the grant).
- Capabilities are enforced **twice**: the main process strips and redacts context the
  plugin has no grant for *before* the fork boundary, and the sandbox refuses ungranted
  API calls.

No permission is required for: `relay.toast`, `relay.log/info/warn/error`,
`relay.config` (its own config), receiving the `buttonId`.

---

## 5. Execution model & lifecycle

### 5.1 Sandbox

Each event dispatch forks the app bundle with:

- `RELAY_PLUGIN_SANDBOX=1` → the fork runs `startPluginSandboxHost()` instead of Electron;
- `ELECTRON_RUN_AS_NODE=1` → plain Node, no Chromium;
- `--disallow-code-generation-from-strings` → `eval`/`new Function` are dead, which is
  the only known `node:vm` escape vector. The child self-tests this flag and **fails
  closed** if it is not in effect (identical to `src/main/scripting/index.ts`).

Inside the child, `main.js` is evaluated with `runInContext` in a context created with
`codeGeneration: { strings: false, wasm: false }` whose only globals are a **frozen**
`relay` API and a capturing `console`. Returned data is JSON-round-tripped, so functions
and host objects cannot leak out.

Limits (constants in `src/main/plugins/host.ts` / `sandbox.ts`):

| Bound | Value |
|-------|-------|
| synchronous evaluation | 3 s (`vm` timeout) |
| async handler settle | 10 s |
| hard wall-clock (child killed) | 15 s |
| concurrent plugin sandboxes | 2 (button clicks queue; hooks coalesce, see §5.2) |
| `main.js` size | 512 KB |
| `relay.fetch` | 5 calls/event; 10 s and ≤ 5 redirect hops per call; response ≤ 1 MB |

### 5.2 Events

| Event | Fired when | Handler key | Context |
|-------|-----------|-------------|---------|
| button click | user clicks a contributed button | `button:<buttonId>` (fallback: `button`) | `{ buttonId, request?, response? }` |
| `response` | the HTTP engine finished a request (declared via `contributes.events: ["response"]`) | `response` | `{ request?, response? }` |
| `request` | before send, BLOCKING (declared via `contributes.events: ["request"]`, needs `request:write`) | `request` | `{ request? }` |
| panel render | a panel tab is opened/refreshed (or an interactive panel posts a message) | `panel:<panelId>` (fallback: `panel`) | `{ panelId, request?, response?, message? }` |
| command | the user runs a contributed command from the palette (Cmd/Ctrl+K) | `command:<commandId>` (fallback: `command`) | `{ commandId, request?, response? }` |
| `workspace` | the active workspace switched (`contributes.events: ["workspace"]`) | `workspace` | `{ workspace }` |
| `collection` | the collections document changed (`contributes.events: ["collection"]`) | `collection` | `{}` (+ history if granted) |

The `request` hook runs in series before send and may patch the resolved spec via
`relay.request.*`, so it **does block the send** (that is the point — it changes the
request). To keep that bounded, each request hook has a short per-hook timeout (5 s, vs
the 15 s fire-and-forget wall): a slow/hung plugin is killed and skipped rather than
stalling the send, and cancelling the request aborts the remaining hooks. **Security:** a
hook may freely rewrite the request **within the user's origin**, but a CROSS-ORIGIN
retarget is honored only if the plugin holds `net`/`net:<host>` for the new host (the same
gate `relay.fetch` uses) — otherwise the URL swap is refused and the request keeps its
original URL. Even on an allowed cross-origin retarget the user's auth, credential-bearing
headers, body and query string are stripped (see §8), so `request:write` can never forward
the user's secrets (in auth, a header, the body, or a query param) to another host; a
plugin that needs to POST cross-origin supplies its own body and uses its own `net` grant.

The `workspace` and `collection` events are fire-and-forget (same coalescing as
`response`): `workspace` fires when the active workspace switches (`ctx.workspace`),
`collection` when the collections document is saved.

The `response` hook is dispatched **fire-and-forget from the main process** after
`request:send` completes — it works for manual sends and the collection runner alike and
can never delay or fail the request itself (dispatch is deferred off the IPC response
path, and user-cancelled requests are skipped; transport failures with `status: 0`
ARE dispatched — alerting plugins want them). It is **best-effort and lossy by design**:
per plugin, at most one run is in flight and only the *latest* pending event is kept
(latest-wins coalescing), so a collection run cannot pile up forked children. Plugins
must not rely on receiving every response.

Observability (the v1 debugging surface):

- a hook run that ends in an error (and produced no toast) raises an **attributed** error
  toast — «Плагин `<name>`: `<error>`» — deduplicated per plugin (identical toasts within
  10 s are dropped);
- every run's outcome (`lastRun`: timestamp, event, duration, error, log tail) is shown
  on the plugin's card in «Плагины», pushed as a fine-grained
  `plugins:event {type:'lastRun'}` broadcast and merged client-side (a full `changed`
  refetch here would rescan the folder per run and clobber config fields mid-typing);
- button-run logs additionally land in the renderer devtools console.

### 5.3 Hot reload

`PluginManager` watches the plugins directory with a single recursive `fs.watch`
(supported on macOS/Windows/Linux on current Electron). Watcher errors re-arm the watch
after recreating the folder. Changes are debounced (300 ms), the scan cache is dropped,
and the renderer receives `plugins:event {type:'changed'}` and refreshes. The «Обновить»
button (and any `plugins:list` call) always forces a fresh scan — the escape hatch for a
missed watcher event. `main.js` is read from disk at dispatch time, so code edits apply
to the very next event.

---

## 6. Extension points

### 6.1 Buttons

`contributes.buttons[].location`:

| Location | Where it renders | Status |
|----------|------------------|--------|
| `response-toolbar` | the response status bar action row (next to «Спросить AI») | **done** |
| `titlebar` | left of the environment pill (compact icon button) | **done** |
| `sidebar` | the sidebar footer, above «Консоль» | **done** |

Titlebar/sidebar buttons act on the ACTIVE tab's request + its current response (built by
the renderer, re-filtered by grants in main).

The status bar is a no-wrap row (and split view halves it), so at most **3 plugin
buttons render inline** across all plugins (ordered by plugin id); the rest collapse
into a «⋯» overflow menu. While an event runs the button is disabled with a spinner.
Every click visibly resolves: the result toast, the error toast, or an attributed
«готово» — all rendered by trusted chrome as «Плагин `<name>`: …».

Clicking a button invokes the plugin with the active tab's request/response snapshot
(filtered by grants and redacted in main — the renderer's copy is advisory input only).

### 6.2 Themes

Theme contributions are **pure data** — validated at manifest parse time (keys must be
`--` custom properties, values must pass the color/number allowlist) and applied through
the existing custom-theme engine. «Применить» on the plugin card performs a single
`useSettings.update({ themePreset: 'custom', customTheme })` with **provenance**
(`customTheme.source = { pluginId, themeId }`) and stashes the user's previous appearance
in `SettingsDoc.appearanceSnapshot` (only when overwriting a hand-built theme, so
chaining plugin themes keeps the original backup). The applied theme's button becomes
«Вернуть прежнюю», which restores the snapshot. The copied theme survives plugin
removal — nothing breaks, it is simply the user's custom theme now.

### 6.3 Panels

A `contributes.panels[]` entry (`location: 'response-tab'`) adds a tab to the response
panel. Opening/refreshing it dispatches the `panel:<id>` event; the handler builds HTML
via `relay.panel.set(html)`, and the renderer shows that HTML in a **fully sandboxed
`<iframe>`** (`sandbox=""`, CSP `default-src 'none'; img-src data:; style-src
'unsafe-inline'`) — no scripts, no remote loads, same model as the response HTML preview.
The renderer never executes plugin JS in its own realm; the panel's data is produced by
the sandboxed handler. A «Обновить» button re-runs the handler.

**Interactive panels** (`interactive: true`): the iframe is rendered with
`sandbox="allow-scripts"` but **no** `allow-same-origin`, so it is a *null origin* — its
script can't reach the app, cookies, storage, or the network (the CSP still blocks
`default-src`); it can only `parent.postMessage(...)`. The renderer forwards that message
to the plugin's `panel:<id>` handler as `ctx.message`; whatever HTML the handler then
sets re-renders the iframe. This is the only place plugin-authored markup may run scripts,
and only inside that contained null-origin frame.

### 6.4 Commands

`contributes.commands[]` adds entries to the command palette (Cmd/Ctrl+K, group
«Плагины»). Selecting one runs the `command:<id>` handler with the active tab's
request/response context (grant-filtered in main).

---

## 7. Runtime API (`relay.*`)

Available inside `main.js` (frozen object, the only global besides `console`; there are
**no timers** in the sandbox — microtasks only):

| Member | Permission | Description |
|--------|-----------|-------------|
| `relay.on(event, fn)` | — | register a handler; last registration per event key wins |
| `relay.config` | — | frozen `Record<string,string>` of the user's config values |
| `relay.toast(message, kind?)` | — | queue a toast (`'ok'` \| `'error'`, ≤ 300 chars); the last one wins; rendered attributed to the plugin |
| `relay.log/info/warn/error(...)` | — | captured console lines (also `console.*`); tail shown on the plugin card |
| `relay.fetch(url, init?)` | `net` / `net:<host>` | bare fetch (no app cookie jar / proxy / certs), `init = { method?, headers?, body? }` |
| `relay.storage.get/has/set/delete/keys` | `storage` | plugin-scoped KV (string values); mutations are recorded and persisted by main after the run |
| `relay.request.setUrl/setMethod/setHeader/removeHeader` | `request:write` | mutate the request in a `request` handler (header ops by name) |
| `relay.panel.set(html)` | — | set the HTML for a `panel:<id>` handler (rendered in a sandboxed iframe) |
| `relay.clipboard.writeText(text)` | `clipboard` | copy text to the OS clipboard (written by main after the run) |
| `setTimeout` / `clearTimeout` | — | bounded timers (≤ 50 live, ≤ 5 s each); all cleared when the run ends, so `await new Promise(r => setTimeout(r, ms))` works for short delays |

`relay.fetch` resolves to a `pm.sendRequest`-shaped object (it never crosses the fork
boundary, so methods are fine):

```ts
{
  ok: boolean
  status: number
  statusText: string
  truncated: boolean                        // body was cut at the 1 MB cap
  headers: { get(name): string | undefined  // case-insensitive
             all(): Record<string, string> } // lowercase keys
  text(): string
  json(): unknown                           // JSON.parse — throws on invalid
}
```

Failure semantics (contract):

- timeout ⇒ rejects with `relay.fetch: timed out after 10s` (spans the redirect chain);
- redirect to a non-granted host ⇒ rejects with `relay.fetch: redirected to a host not
  allowed…` **before** the hop request is sent; > 5 hops ⇒ `too many redirects`;
- the 6th call in one event ⇒ rejects (`at most 5 calls per event`);
- an over-cap body does NOT reject — it is truncated with `truncated: true`;
- credential-looking request headers are stripped on cross-origin hops (same
  `CREDENTIAL_HEADER_RE` as the HTTP engine); 301/302/303 downgrade to GET and drop the
  body, 307/308 preserve them.

Event context (`ctx`): `buttonId?` / `panelId?` (for button/panel events), `request?`
(`{ method, url, headers }`, redacted), `response?` (`{ status, statusText, headers,
contentType, bodyText?, truncated?, sizeBytes, timeMs, finalUrl }`, capped). Handlers may
be `async`; the run finishes when the returned promise settles or the 10 s bound elapses.

`relay.request.*` (request:write) header ops are applied to the resolved spec *before* the
engine attaches spec-level auth, so a header the request's Auth config also produces (e.g.
`Authorization` for `bearer` auth) is overwritten by that config — the user's auth wins. To
fully control a header, leave the request's Auth set to «None».

---

## 8. Security model

Threat model: a plugin is **untrusted third-party code** (downloaded from the internet,
pasted by a friend). The renderer and main process are trusted app code.

What a plugin **cannot** do, by construction:

| Attack | Defense |
|--------|---------|
| reach Node / Electron APIs | `node:vm` context with only `relay` + `console`; codegen disabled at process level (`--disallow-code-generation-from-strings`) **and** context level; child self-test fails closed |
| touch the renderer DOM / `ipcRenderer` | plugin JS never ships to the renderer; UI contributions are static JSON rendered by trusted components |
| read API keys / safeStorage secrets | the sandbox child receives only: plugin code, granted permissions, the plugin's OWN config (incl. its OWN decrypted secret fields), its OWN KV store, and the redacted event context. App secrets, AI provider keys, the decrypted secret store, and other plugins' data never cross the fork boundary |
| render a panel that runs scripts / phones home | non-interactive panels: `<iframe sandbox="">` + CSP `default-src 'none'` (no scripts, no remote loads). **Interactive** panels: `sandbox="allow-scripts"` WITHOUT `allow-same-origin` → null origin (can't reach the app, cookies, storage) and CSP still blocks all network; the iframe can only `postMessage` to the app |
| read the OS clipboard / spam it | `relay.clipboard` is WRITE-only (`writeText`), gated by the `clipboard` permission, capped at 100 KB, and performed by main |
| mine request history | `history:read` exposes only the newest ≤ 25 entries (method/url/status/timing), URLs redacted (query values masked) — never bodies or headers |
| attack via `installZip` | compressed AND decompressed size are capped (zip-bomb guard via fflate's per-entry filter); the manifest is fully validated; the id is bound to the destination folder; each entry is written only if its path stays under `plugins/<id>/` (no `..`/absolute/symlink/out-of-prefix escape); and a freshly-installed plugin ALWAYS starts **disabled with no grants** — even a same-id overwrite of a trusted plugin — so swapped code can never run under old grants without re-approval. (No signature/"verified" claim is shown: a signature inside the archive proves nothing without a pinned trust anchor — that needs a hosted registry, §11.) |
| persist beyond its quota / escape its store | `relay.storage` is a per-plugin KV (≤ 100 keys, ≤ 8 KB/value) snapshotted in / applied out by main, stored OUTSIDE the plugin folder so the plugin can't rewrite its own state file directly |
| inject a malicious request via `request:write` | only ordered header set/remove-by-name + url/method ops cross the boundary (never a round-trip of the redacted header set); applied to the resolved spec in main |
| siphon the user's auth/body/query to another host via a `request:write` URL swap | a cross-origin retarget is **refused unless the plugin holds `net`/`net:<host>` for the new host** (the same gate `relay.fetch` uses) — so the request hook never grants more reach than the plugin already has; the user's request keeps its original URL otherwise. Even on an allowed cross-origin retarget the user's auth (`spec.auth`), credential-bearing headers (`CREDENTIAL_HEADER_RE`), request **body** and **query string** are stripped before send, so the app never forwards the user's secrets to another origin; a plugin POSTs cross-origin only via `relay.fetch` with its own `net` grant and its own body |
| stall every request via a hung `request` hook | the pre-request hook is bounded by a 5 s per-hook timeout (vs 15 s for fire-and-forget events); a slow plugin is killed + skipped, and request cancellation aborts the remaining hooks |
| steal credentials from the snapshot | header values matching the engine's `CREDENTIAL_HEADER_RE` are masked; in URLs (incl. the post-auth `finalUrl`) userinfo is stripped, the **fragment is dropped** (OAuth implicit-flow `#access_token=…` never reaches a plugin) and **every** query value is masked — not name-guessed — so the engine's apikey-in-query auth (a user-chosen param name) can't leak; `CREDENTIAL_HEADER_RE` is shared with the engine so header masking and redirect stripping can't drift. **Caveat (honest scope):** masking is header-NAME-based and URL-value-based; a secret the user places in a custom-named header or a response body IS visible to a plugin granted `request:read`/`response:read` — that is the point of the permission, and the grant dialog says so. Treat those grants as "this plugin can read my request/response data." |
| exfiltrate without consent | network requires the user-granted `net` permission; `net:<host>` is re-checked on **every redirect hop** before the request is sent |
| exfiltrate via theme CSS (`url(...)` beacons) or spoof trusted chrome | theme var values must pass a color/number allowlist at manifest-validation time; rejected values never persist. (Defense-in-depth: the renderer CSP already blocks remote `img-src`/`font-src`.) |
| hang or DoS the app | per-event child process, 15 s hard kill, concurrency cap 2, hook coalescing (≤ 1 running + 1 pending per plugin), fetch/response/body/log caps |
| escape via `plugin.json` / symlinks | strict manifest validation; `main` may not contain separators; plugin file reads are lstat'd (symlinks rejected) and realpath-confined to the plugins folder; `installSample` refuses symlinked targets |
| impersonate another plugin | folder name must equal manifest `id`; toasts are attributed by trusted chrome, never by the plugin |
| silently escalate permissions on update | `granted` is a snapshot; any superset requirement disables the plugin until re-approved, with the diff shown; a deleted-then-reinstalled folder starts disabled |

Residual risks (documented, accepted for v1):

- a granted plain `net` permission allows posting the (already redacted) context
  anywhere — that is exactly what the user approved; `net:<host>` is the scoping knob;
- DNS rebinding of a granted host is not mitigated (no resolved-IP pinning in v1);
- header redaction is name-based — a custom non-matching header name (e.g. `X-Session`)
  passes through; query values are fully masked, but a secret embedded in the URL **path**
  still passes through; host-scoped grants mitigate exfiltration;
- the response body itself may contain secrets the server returned, which no client can
  distinguish from data.

---

## 9. Settings UI — «Плагины»

`SettingsScreen` has a nav item between «Внешний вид» and «Основные». The section shows:

- «Открыть папку», «Установить пример» (asks before overwriting an existing sample
  folder), «Установить из .zip» (native picker; validates the archive, writes it under
  `plugins/<id>/`, and **starts the plugin disabled** so the user must grant it), «Обновить»
  (forced rescan);
- one card per discovered plugin: name/version/author, description, permission
  consequence lines (RU), contributed buttons (with their location) / panels / commands / hooks,
  config fields — including **secret fields** as password inputs with a «сохранено»
  state and a clear button — the **net host-allowlist editor** (for plugins granted broad
  `net`), the enable-and-grant toggle («Включить и разрешить»), the escalation diff when
  re-approval is needed, the validation error if broken, the last-run status line with a
  collapsible log tail, and «Удалить» (two-step confirm; removes the folder + the
  plugin-scoped KV store + safeStorage secrets, and purges stored state);
- theme contributions with «Применить» / «Вернуть прежнюю».

---

## 10. IPC & storage surface (implementation map)

| Piece | Location |
|-------|----------|
| channels `plugins:list/setEnabled/setConfig/setSecret/setNetAllowlist/invokeButton/invokePanel/panelMessage/invokeCommand/openFolder/installSample/installZip/delete` + broadcast `plugins:event` | `src/shared/ipc-contract.ts`, exposed as `window.api.plugins*` / `onPluginsEvent` in `src/preload/index.ts` |
| shared types (`PluginManifest`, `PluginInfo`, `PluginRunRequest/Result`, `PluginRequestPatch`, `PluginRunKind`, …) | `src/shared/types.ts` |
| manifest validation + i18n resolution + theme-value allowlist + `apiVersion` (pure, unit-tested) | `src/main/plugins/manifest.ts` |
| sandbox runner: `relay.{fetch,storage,request,panel,clipboard}`, bounded timers, manual-redirect fetch (pure, unit-tested) | `src/main/plugins/sandbox.ts` |
| pure helpers: `effectivePermissions` / `applyRequestPatch` (unit-tested) | `src/main/plugins/perms.ts` |
| context redaction helpers (`maskHeader` / `redactUrl`, unit-tested) | `src/main/plugins/redact.ts` |
| fork host (mirror of the `pm.*` host, fail closed; per-event timeout override) | `src/main/plugins/host.ts` |
| manager: scan, confinement, grants, secrets, KV storage, history, redaction, coalescing dispatch, request/response/workspace/collection/command/panel hooks, zip install (`fflate`, size-bounded, starts disabled), clipboard, watcher, IPC | `src/main/plugins/index.ts` |
| sample plugin (embedded source, written by «Установить пример») | `src/main/plugins/sample.ts` |
| `plugins` storage key (app-level doc: enable/grant/config/netAllowlist); save-listener fires `collection` events | `src/main/storage/` |
| plugin secrets in safeStorage (`plugin:<id>:<key>`) + plugin-scoped KV in `relay-data/plugin-data/<id>.json` | `StorageManager.secrets`, `src/main/plugins/index.ts` |
| request + response hook dispatch | `registerHttpHandlers(ipcMain, cookieJar, onResponse, onRequest)` in `src/main/http/index.ts`, wired in `src/main/ipc/index.ts` |
| shared credential pattern | `CREDENTIAL_HEADER_RE` exported from `src/main/http/engine.ts` |
| shared snapshot mappers | `src/shared/plugin-context.ts` |
| sandbox child role branch | `src/main/index.ts` (`RELAY_PLUGIN_SANDBOX === '1'`) |
| renderer store + UI | `src/renderer/store/plugins.ts`; `PluginsSection.tsx`; toolbar buttons + panels in `ResponsePanel.tsx`; titlebar buttons in `app/Titlebar.tsx`; sidebar buttons in `features/sidebar/Sidebar.tsx`; commands in `features/palette/CommandPalette.tsx` |

---

## 11. Roadmap

All originally-deferred P1 **and P2** items are implemented: secret config, `storage`,
`request:write`, panels, titlebar/sidebar buttons, per-host grant editor, `apiVersion`,
command-palette commands, `clipboard` + `history:read`, `workspace`/`collection` events,
bounded sandbox timers, interactive (postMessage) panels, i18n label overrides, and
install-from-`.zip` (size-bounded; freshly-installed plugins start disabled).

Genuinely remaining (needs distribution infrastructure, not app code):

- **Hosted plugin registry / marketplace with signing** — a server that hosts plugins and
  signs them against PINNED trust keys the app ships. Install-from-`.zip` works today, but
  *meaningful* signature verification needs that pinned-key/registry story (a self-signed
  archive proves nothing), which is a product/infra decision — not something the desktop
  app can "finish" offline. Deliberately NOT faked with an in-archive self-signature.
