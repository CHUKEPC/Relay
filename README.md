# Relay — API Client with a built-in AI Assistant

A cross-platform desktop **API client** (a Postman analog) for **Windows, macOS, and Linux**, built
with **Electron + React + TypeScript**. Its signature feature is a built-in **AI assistant** you
connect to any LLM provider (OpenAI, Anthropic/Claude, OpenRouter, or any OpenAI-compatible
endpoint) with your own API key — it understands the current request, response, and environment and
helps you build, debug, and test APIs right inside the app.

> "Relay" is the product name (set in `package.json` → `productName` and `src/shared/constants.ts`
> → `APP_NAME`). Rename in those two places.

## Highlights

- **CORS-free HTTP engine** in the Electron main process: all methods, every body type
  (raw/urlencoded/form-data/binary/GraphQL), auth (Bearer/Basic/API-key/OAuth2/Digest/inherit),
  redirects with a recorded chain, timeout, TLS toggle, cancellation, timing & size metrics.
- **Multi-provider AI assistant** with token-by-token streaming, secret-masked context injection,
  "Apply to request" actions, and tool-calling (read/modify/send the request, with confirmation).
- **Collections, environments & global variables** with `{{var}}` interpolation everywhere,
  hover-resolution, and unresolved flagging.
- **Monaco-powered** request bodies and a Pretty/Raw/Preview response viewer.
- **Pre-request & Test scripts** with a sandboxed `pm.*` API and a Test Results tab.
- **Import** Postman v2.1 / OpenAPI 3 / cURL, **export** Postman v2.1, **code generation**
  (cURL/HTTP/JS/Python, twelve more languages with a pack), **paste-cURL**, command palette,
  keyboard shortcuts.
- **Collection runner** for a collection, a folder or any ticked set of requests: iterations, a
  CSV/JSON data file, stop-on-failure and a JSON report.
- **Send to terminal**: one click runs the request with curl (or HTTPie, wget, PowerShell) in a new
  terminal window, with variables, auth, cookies, proxy and TLS settings carried over.
- **Variable import and export** — Postman, JSON, `.env` and CSV — for globals, environments and
  collections.
- **Plugins**: feature packs (themes, snippets, code-generation languages, UI languages, protocols)
  and sandboxed code plugins —
  see the [plugin guide](docs/plugin-guide/README.md) ([по-русски](docs/plugin-guide/README.ru.md)).
- **Find & replace across the workspace**: search collections, environments and variables by field
  group, then replace exactly the matches you confirm.
- **Local-first**: everything persists as JSON in `userData`; API keys are encrypted via Electron
  `safeStorage`. No telemetry; the only outbound traffic is your own API and AI calls.

## Run it

```bash
npm install          # install dependencies
npm run dev          # launch the desktop app (electron-vite, HMR)
```

If `npm install` fails with an `EACCES` cache error (root-owned `~/.npm`), use a project-local cache:

```bash
npm install --cache ./.npmcache
```

### Build & package

```bash
npm run build        # type-check + bundle (main/preload/renderer)
npm run build:mac    # package macOS dmg + zip   (electron-builder)
npm run build:win    # package Windows NSIS installer
npm run build:linux  # package Linux AppImage + deb
```

Packaged artifacts land in `release/`. macOS/Windows builds are unsigned by default — configure
signing/notarization in `electron-builder.yml` for distribution.

### Releases

Pushing a version tag builds Windows, macOS and Linux packages in GitHub Actions
(`.github/workflows/release.yml`) and publishes them. Without Actions, publish from each OS:

```bash
git tag v1.2.0
git push origin v1.2.0
npm run release        # builds for this OS and uploads to the v1.2.0 release
```

`npm run release` needs `gh auth login` or a `GH_TOKEN` with write access to the repository
contents; run it on Windows, macOS and Linux to add each system's files to the same release.
On Windows, `npm run release -- --linux-tar` also builds a portable Linux `tar.gz` (the script
restores the execute bits NTFS cannot store); `.deb`, `.AppImage` and the macOS `.dmg` need a
Linux / macOS machine or the CI workflow.
Release notes are read from `docs/releases/v<version>.md`.

### Test & lint

```bash
npm test                       # Vitest: HTTP engine, interpolation, AI adapters, cURL, scripting
RELAY_NET_TESTS=1 npm test     # also run live httpbin.org network tests
npm run lint                   # eslint + tsc --noEmit
```

## Connect an AI provider

1. Open **Settings → AI-провайдеры** (sidebar bottom, or `⌘/Ctrl+,`).
2. Pick a provider (Anthropic, OpenAI, OpenRouter, or a custom OpenAI-compatible base URL for
   Ollama/LM Studio) and paste your API key. It is stored **encrypted** locally and never leaves
   your machine except in requests to that provider.
3. Open the AI panel (`⌘/Ctrl+J`), pick a model, and ask away.

For local models (Ollama/LM Studio), add a custom provider with base URL e.g.
`http://localhost:11434/v1` and leave the key blank.

## Where things live

- HTTP engine: [`src/main/http`](src/main/http) · AI client: [`src/main/ai`](src/main/ai)
- Storage + encrypted secrets: [`src/main/storage`](src/main/storage)
- Shared contract: [`src/shared`](src/shared) (types, IPC contract, interpolation, cURL)
- Renderer UI: [`src/renderer`](src/renderer) (features, components, Zustand stores)
- Design source of truth: [`design/`](design)

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — processes, IPC, data flow, storage, security.
- [`docs/FEATURES.md`](docs/FEATURES.md) — the Postman-parity feature checklist (current status).
- [`docs/AI_ASSISTANT.md`](docs/AI_ASSISTANT.md) — the multi-provider AI assistant spec.
- [`CLAUDE.md`](CLAUDE.md) — project constitution and locked technical decisions.
