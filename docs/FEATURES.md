# FEATURES.md — Postman-parity feature target

The goal is **maximum Postman parity** plus the **AI assistant** differentiator. Features are
tiered by priority. **P0 must work** in the first build. P1 should be attempted in the same build
and is expected to mostly work. P2 is best-effort / future. Anything requiring a hosted backend
(team sync, cloud workspaces) is **out of scope** — this app is **local-first**.

Legend: `[x]` done · `[~]` partial · `[ ]` not yet. Updated to reflect the implemented build.

---

## P0 — Core (all implemented & verified)

### Request builder
- [x] Method selector: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS (+ custom via engine).
- [x] URL bar with `{{variable}}` highlighting and inline hover resolution (source + value).
- [x] Query params editor: key / value / description / enabled checkbox; two-way sync with URL.
- [x] Path variables (`:id` style) auto-detected from the URL and editable.
- [x] Headers editor: key / value / enabled; common-header name autocomplete; note about auto-added headers.
- [x] Body types:
  - [x] none
  - [x] raw with language selector (JSON, Text, XML, HTML, JavaScript) via Monaco; sets Content-Type
  - [x] `x-www-form-urlencoded` (key/value/enabled table)
  - [x] `form-data` (text **and** file fields; file picker)
  - [x] binary (single file upload)
  - [x] GraphQL (query editor + variables editor)
- [x] "Beautify"/format action for JSON/XML bodies.

### Auth
- [x] No Auth
- [x] Bearer Token
- [x] Basic Auth (username/password → base64)
- [x] API Key (add to header or query param)
- [x] Inherit auth from parent collection/folder (walks the tree)
- [x] OAuth 2.0 (token fetch + attach), Digest (best-effort) — see P1

### Sending & response
- [x] Send button; cancel in-flight request.
- [x] Status code + reason, response time (ms), response size (B/KB/MB).
- [x] Response body tabs: **Pretty** (Monaco, JSON/XML/HTML with folding + syntax highlight),
      **Raw**, **Preview** (sandboxed `<iframe>` HTML; rendered image for image responses).
- [x] Pretty viewer via Monaco with folding + in-editor search (Cmd/Ctrl+F).
- [x] Response headers table.
- [x] Response cookies table (parsed from Set-Cookie).
- [x] Copy response; save response to file.
- [x] Graceful errors: DNS/connection/TLS/timeout shown as structured error states, never crash.

### Collections & tabs
- [x] Left sidebar: tree of collections → folders → requests.
- [x] Create / rename (inline) / delete / duplicate collections, folders, requests (context menu).
- [x] Save current request into a collection (Save / Save As with target picker).
- [x] Multiple open requests as **tabs**; dirty/unsaved indicator; reopen on restart.
- [x] Reorder via **drag-and-drop** (native HTML5 DnD: reorder requests/folders within and
      between folders/collections, reorder top-level collections; drop indicators; cycle-safe).

### Variables & environments
- [x] Environments: create / duplicate / delete / rename / select active environment.
- [x] Environment variables and **global** variables (key / value / enabled / secret).
- [x] Variable interpolation `{{var}}` in URL, params, path vars, headers, body, and auth.
- [x] Resolution precedence: collection → environment → global (+ dynamic `{{$...}}`).
- [x] Variable name highlighting; hover shows resolved value & source; unresolved vars flagged.

### History
- [x] Every sent request is logged (method, url, status, time, timestamp).
- [x] Click a history item to restore it into a tab.
- [x] Clear history. Capped to `maxHistory`.

### Persistence & settings
- [x] Collections, environments, globals, history, open tabs, providers, and settings persist to
      disk (atomic JSON in userData) and survive restart.
- [x] Settings screen: theme (light/dark/system), request timeout, SSL verification on/off,
      follow-redirects on/off, max history, word-wrap, AI-context toggle, accent color.
- [x] AI provider settings: add providers, store API keys **encrypted** (safeStorage), pick default
      provider/model, dynamic model listing.

### AI assistant (the differentiator) — see docs/AI_ASSISTANT.md
- [x] Dockable AI panel with a chat thread.
- [x] Provider + model picker (OpenAI, Anthropic, OpenRouter, custom OpenAI-compatible).
- [x] **Streaming** responses (token-by-token over IPC).
- [x] **Context** about current request, last response, and active environment (secret-masked).
- [x] Core use-cases: explain a response, generate a request, suggest fixes, write a test, convert to code.
- [x] "Apply to request" / "insert" actions for AI-produced HTTP / cURL / test / JSON snippets.

---

## P1 — High value (attempted in this build)

- [x] **Pre-request scripts** and **Tests** in a sandboxed `vm` runtime with a `pm.*` subset
      (`pm.environment`, `pm.globals`, `pm.variables`, `pm.request`, `pm.response`, `pm.test`,
      `pm.expect` chai-style). Results shown in a **Tests** tab with console output.
- [x] **Import**: Postman Collection v2.1 JSON, OpenAPI 3.x, and cURL (paste or file).
- [x] **Export**: collection as Postman v2.1 JSON.
- [x] **Code generation**: cURL, JavaScript (fetch), Python (requests), Node, Go.
- [x] **Paste cURL** into the URL bar to auto-fill the whole request.
- [x] **OAuth 2.0** (client credentials + password grant token fetch).
- [x] **Digest auth** — full RFC 7616 challenge/response (MD5, SHA-256 and `-sess` variants;
      qop=auth; legacy RFC 2069 fallback). The first request is sent unauthenticated; the engine
      answers the 401 `WWW-Authenticate: Digest` challenge and replays once. Unit-tested against
      the canonical RFC vectors.
- [x] **Cookie manager**: persistent, editable jar in main (per workspace) — auto-captures
      `Set-Cookie` and auto-attaches matching cookies (domain/path/secure/expiry) to requests; a
      Cookie Manager UI (grouped by domain; add/edit/delete; clear-all / clear-by-domain). The
      per-response Cookies table remains.
- [x] Save **response examples** on a request (save the current response as a named example;
      Examples tab to view/restore/delete; restore shows the stored response without sending;
      round-trips to/from Postman v2.1 `item.response[]`).
- [x] **Bulk edit** for params/headers (key:value text mode; `//` disables a row; blank lines
      ignored; lossless two-way, preserving enabled state + descriptions).
- [x] **Extended auth types** (pure `node:crypto`, vector-tested): **JWT Bearer** (HS/RS/PS),
      **OAuth 1.0a** (HMAC-SHA1/256, PLAINTEXT), **AWS Signature v4** (incl. UNSIGNED-PAYLOAD for
      multipart), **Hawk**, **Akamai EdgeGrid**, **ASAP**. Token-style auth attaches a header;
      request-bound auth is signed after the body is assembled. (NTLM deferred — needs MD4 + a
      multi-step handshake.)
- [x] **Test snippets** — a Snippets panel in the Scripts editor inserts ready `pm.test`/`pm.expect`
      boilerplate (status code, response time, body contains/equals/JSON value, header checks,
      set/get env vars, …).
- [x] **HTTP/2** — optional ALPN negotiation (undici `allowH2`), toggle in Settings → Network.
- [x] **Search** across collections/requests; **command palette** (Cmd/Ctrl+K).
- [x] Keyboard shortcuts (Send = Cmd/Ctrl+Enter, new tab ⌘N, save ⌘S, close tab ⌘W, AI ⌘J, settings ⌘,).
- [x] **AI tool-calling**: assistant can read/modify the current request, set variables, and send the
      request — mutating/sending actions gated by an explicit confirmation dialog (auto-apply toggle in Settings).

---

## P2 — implemented locally (no hosted backend needed)

- [x] Collection **Runner** (N iterations + optional CSV/JSON data file). Each iteration binds one
      data row as the highest-precedence scope and exposes `pm.iterationData`; runs every request
      in order with pre-request/test scripts; live progress; per-request/iteration pass/fail; stop.
- [x] **WebSocket** + **SSE** client (main-process engines over undici; per-connection IPC event
      stream; custom handshake headers; WS send + binary frames as base64; SSE `event/data/id/retry`
      parsing with auto-reconnect + `Last-Event-ID`). Mode switch in the URL bar; messages/events
      panel + composer.
- [x] Response **visualizer**: `pm.visualizer.set(template, data)` rendered with a safe, pure
      template engine inside a locked-down `<iframe sandbox>` (no scripts, no network, strict CSP);
      plus a zero-config auto-table for JSON arrays.
- [x] **Proxy** configuration (undici `ProxyAgent`, proxy auth + no-proxy bypass list) and **client
      TLS certificates** (per-host PEM/PFX + optional CA + passphrase; bytes read only in main).
      Configured in Settings → Network.
- [x] **Workspaces** (local, multiple): each its own isolated collections/environments/globals/
      history/tabs/cookies under a per-workspace dir; titlebar switcher (create/rename/delete/
      switch) with hot-reload on switch. App-level settings, AI providers and secrets are shared.
- [x] **GraphQL** request mode (HTTP POST with a `{query, variables}` body editor; selectable from
      the protocol dropdown).
- [x] **Socket.IO** client (pure-JS `socket.io-client` in main; connect, emit events, listen, with
      bounded reconnection) — a realtime mode with an event + payload composer.
- [x] **MQTT** client (pure-JS `mqtt.js` in main; connect over mqtt(s)/ws(s), subscribe, publish) —
      a realtime mode with topic subscribe + publish composer.
- [x] **gRPC** client (pure-JS `@grpc/grpc-js` + `@grpc/proto-loader`, no native modules): paste or
      upload a `.proto`, parse it into services/methods, pick a method, edit the request message as
      JSON, set call metadata, and invoke. Supports **unary, server-streaming, client-streaming and
      bidi**; plaintext (h2c) or TLS; results stream into a live log (with a Send/Finish composer for
      client-/bidi-streams). A request "mode" like the realtime protocols.
- [x] **SQLite** backup (optional, pure-WASM `sql.js`, no native modules): export the current
      workspace (collections, environments, globals, history) to a portable `.sqlite` file and import
      it back (Settings → Данные). The file is a real SQLite database with readable columns plus
      lossless `json` columns. NOTE: per CLAUDE.md the **JSON document store remains the canonical
      backend** — SQLite is a backup/interchange format here, NOT a replacement storage engine
      (`better-sqlite3`, a native module, is still intentionally avoided to keep the build green).

## Out of scope (needs a hosted backend)

- Cloud sync, team workspaces, sharing links, mock servers, monitors, in-cloud history.
