/**
 * Shared type contract used across main, preload and renderer.
 * Must have NO Node or DOM dependencies.
 */

/* ============================================================
 * HTTP request engine
 * ============================================================ */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | (string & {})

export interface KV {
  /** stable id for React keys / reordering */
  id?: string
  key: string
  value: string
  enabled: boolean
  description?: string
}

export type RawLanguage = 'json' | 'text' | 'xml' | 'html' | 'javascript'

export interface FormDataField {
  id?: string
  key: string
  /** text field or a file picked from disk */
  type: 'text' | 'file'
  value: string
  /** absolute path(s) on disk for file fields */
  filePath?: string
  fileName?: string
  contentType?: string
  enabled: boolean
  description?: string
}

export type RequestBody =
  | { type: 'none' }
  | { type: 'raw'; language: RawLanguage; text: string }
  | { type: 'urlencoded'; items: KV[] }
  | { type: 'formdata'; items: FormDataField[] }
  | { type: 'binary'; filePath?: string; fileName?: string; contentType?: string }
  | { type: 'graphql'; query: string; variables: string }

export type ApiKeyLocation = 'header' | 'query'
export type OAuth2Grant =
  | 'authorization_code'
  | 'client_credentials'
  | 'password'
  | 'refresh_token'
  | 'device_code'

export type Auth =
  | { type: 'none' }
  | { type: 'inherit' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; key: string; value: string; addTo: ApiKeyLocation }
  | {
      type: 'oauth2'
      grant: OAuth2Grant
      accessToken: string
      headerPrefix: string
      authUrl?: string
      tokenUrl?: string
      clientId?: string
      clientSecret?: string
      scope?: string
      username?: string
      password?: string
      /** authorization_code grant: the code obtained from the redirect */
      code?: string
      redirectUri?: string
      /** PKCE code_verifier (authorization_code); challenge is derived for the auth URL */
      codeVerifier?: string
      /** how client credentials are sent to the token endpoint */
      clientAuth?: 'body' | 'basic'
      /** refresh_token grant: the refresh token to exchange */
      refreshToken?: string
      /** device_code grant: the device authorization endpoint */
      deviceAuthUrl?: string
      /** device_code grant: the device_code returned by the device-authorization step */
      deviceCode?: string
      /** auto-refresh the access token on a 401 (needs refreshToken + tokenUrl) */
      autoRefresh?: boolean
    }
  | {
      type: 'digest'
      username: string
      password: string
      algorithm?: 'MD5' | 'SHA-256' | 'MD5-sess' | 'SHA-256-sess'
      /** send credentials on the first request from a known challenge (no 401 round-trip) */
      preemptive?: boolean
      realm?: string
      nonce?: string
      opaque?: string
      qop?: string
    }
  | {
      /** JWT Bearer — Relay signs a JWT from the payload and attaches it. */
      type: 'jwt'
      algorithm: JwtAlg
      secret: string
      /** JSON object string for the claims payload */
      payload: string
      headerPrefix: string
      addTo: ApiKeyLocation
      queryParamName?: string
    }
  | {
      /** OAuth 1.0a request signing */
      type: 'oauth1'
      consumerKey: string
      consumerSecret: string
      token?: string
      tokenSecret?: string
      signatureMethod: 'HMAC-SHA1' | 'HMAC-SHA256' | 'PLAINTEXT'
      addTo: 'header' | 'query'
    }
  | {
      /** AWS Signature v4 */
      type: 'aws'
      accessKey: string
      secretKey: string
      region: string
      service: string
      sessionToken?: string
    }
  | {
      /** Hawk (holder-of-key) */
      type: 'hawk'
      id: string
      key: string
      algorithm: 'sha256' | 'sha1'
      ext?: string
    }
  | {
      /** Akamai EdgeGrid */
      type: 'akamai'
      clientToken: string
      clientSecret: string
      accessToken: string
    }
  | {
      /** Atlassian ASAP (signed JWT) */
      type: 'asap'
      issuer: string
      audience: string
      keyId: string
      privateKey: string
      subject?: string
    }
  | {
      /** NTLM (NTLMv2) — connection-oriented type1/type2/type3 handshake. */
      type: 'ntlm'
      username: string
      password: string
      domain?: string
      workstation?: string
    }

export type JwtAlg =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'

/**
 * Outbound HTTP/HTTPS proxy configuration. Applied via undici's ProxyAgent.
 * `bypass` is a list of host globs (e.g. `localhost`, `*.internal`, `10.0.0.0/8`
 * is NOT CIDR-matched — only host/suffix globs) that skip the proxy.
 */
export interface ProxyConfig {
  enabled: boolean
  /** proxy origin, e.g. http://127.0.0.1:8080 */
  url: string
  auth?: { username: string; password: string }
  /** hosts that bypass the proxy (exact, or `*.suffix`, or `*`) */
  bypass?: string[]
}

/**
 * A client TLS certificate applied to requests whose host matches `host`.
 * Only file PATHS + an inline passphrase are stored; the key/cert bytes are read
 * in the main process at send time and never travel to the renderer.
 */
export interface ClientCert {
  id: string
  /** host or host:port this cert applies to (exact match, case-insensitive) */
  host: string
  /** PEM cert path (with keyPath), OR pfxPath for PKCS#12 */
  certPath?: string
  keyPath?: string
  pfxPath?: string
  /** optional extra CA bundle (PEM) to trust for this host */
  caPath?: string
  passphrase?: string
}

export interface RequestSettings {
  timeoutMs: number
  followRedirects: boolean
  maxRedirects: number
  rejectUnauthorized: boolean
  encodeUrl?: boolean
  /** resolved proxy for this request (renderer merges global + per-request override) */
  proxy?: ProxyConfig | null
  /** client certs available to match this request's host (paths only) */
  clientCerts?: ClientCert[]
  /** allow HTTP/2 (undici negotiates h2 via ALPN when the server supports it) */
  allowH2?: boolean
}

/** A fully-resolved (variables already interpolated) request ready for the engine. */
export interface RequestSpec {
  method: HttpMethod
  url: string
  query: KV[]
  headers: KV[]
  body: RequestBody
  auth: Auth
  settings: RequestSettings
}

export interface RunOptions {
  /** id used for cancellation tracking */
  requestId: string
}

export type HttpErrorKind = 'dns' | 'connect' | 'tls' | 'timeout' | 'abort' | 'protocol' | 'unknown'

export interface HttpError {
  kind: HttpErrorKind
  message: string
  code?: string
}

export interface ResponseTimings {
  startedAt: number
  ttfbMs?: number
  totalMs: number
}

export interface RedirectHop {
  from: string
  to: string
  status: number
}

export interface ResponseCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
}

export interface ResponseBody {
  /** decoded text when the body is texty */
  text?: string
  /** base64 for binary payloads */
  base64?: string
  contentType: string
  isBinary: boolean
  sizeBytes: number
  encoding?: string
}

export interface ResponseResult {
  ok: boolean
  status: number
  statusText: string
  headers: [string, string][]
  cookies: ResponseCookie[]
  body: ResponseBody
  timings: ResponseTimings
  redirects: RedirectHop[]
  /** the final URL after redirects */
  finalUrl: string
  error?: HttpError
}

/* ============================================================
 * Variables & interpolation
 * ============================================================ */

export interface VariableDef {
  id?: string
  key: string
  value: string
  enabled: boolean
  /** secret values are masked in the UI and in AI context */
  secret?: boolean
}

/** Ordered scopes, highest precedence first when merged. */
export interface VariableScope {
  local?: Record<string, string>
  collection?: Record<string, string>
  environment?: Record<string, string>
  global?: Record<string, string>
}

export type VariableSource = 'local' | 'collection' | 'environment' | 'global' | 'dynamic' | 'unresolved'

export interface ResolvedToken {
  name: string
  value: string | null
  source: VariableSource
}

/* ============================================================
 * Persisted documents (JSON store under userData)
 * ============================================================ */

export interface DocEnvelope {
  version: number
}

/** Protocol mode of a request tab. Defaults to `http` when absent. */
export type RequestMode = 'http' | 'graphql' | 'websocket' | 'sse' | 'socketio' | 'mqtt' | 'grpc'

/** A saved request — the editable unit shown in a tab. */
export interface RequestModel {
  id: string
  name: string
  method: HttpMethod
  url: string
  query: KV[]
  headers: KV[]
  pathVariables: KV[]
  body: RequestBody
  auth: Auth
  /** protocol mode — http (default), websocket, or sse */
  mode?: RequestMode
  /** websocket message draft + saved messages composer text */
  wsMessage?: string
  /** saved realtime message templates (WS/Socket.IO/MQTT) */
  messageTemplates?: MessageTemplate[]
  /** per-request MQTT QoS + Last-Will config (mqtt mode) */
  mqtt?: { qos?: 0 | 1 | 2; lwt?: { topic: string; payload: string; qos?: 0 | 1 | 2; retain?: boolean } }
  /** gRPC mode config (proto text, target, selected service/method, message) */
  grpc?: GrpcConfig
  /** pre-request and test scripts (P1) */
  preRequestScript?: string
  testScript?: string
  /** saved response examples (P1) */
  examples?: ResponseExample[]
  description?: string
}

export interface ResponseExample {
  id: string
  name: string
  status: number
  headers: [string, string][]
  body: string
  contentType: string
}

export type CollectionNode = CollectionFolderNode | CollectionRequestNode

export interface CollectionFolderNode {
  id: string
  type: 'collection' | 'folder'
  name: string
  auth?: Auth
  variables?: VariableDef[]
  preRequestScript?: string
  testScript?: string
  description?: string
  children: CollectionNode[]
}

export interface CollectionRequestNode {
  id: string
  type: 'request'
  request: RequestModel
}

export interface CollectionsDoc extends DocEnvelope {
  collections: CollectionFolderNode[]
}

export interface Environment {
  id: string
  name: string
  variables: VariableDef[]
}

export interface EnvironmentsDoc extends DocEnvelope {
  environments: Environment[]
  activeEnvironmentId: string | null
}

export interface GlobalsDoc extends DocEnvelope {
  variables: VariableDef[]
}

export interface HistoryEntry {
  id: string
  method: HttpMethod
  url: string
  status: number
  ok: boolean
  timeMs: number
  sizeBytes: number
  at: number
  /** snapshot of the request so it can be restored into a tab */
  request: RequestModel
}

export interface HistoryDoc extends DocEnvelope {
  entries: HistoryEntry[]
}

export interface TabModel {
  id: string
  /** the open (possibly unsaved) request draft */
  request: RequestModel
  /** id of the saved request this tab is bound to, if any */
  savedRequestId: string | null
  dirty: boolean
}

export interface TabsDoc extends DocEnvelope {
  tabs: TabModel[]
  activeTabId: string | null
}

export interface SettingsDoc extends DocEnvelope {
  theme: 'light' | 'dark' | 'system'
  accentHue: number
  requestTimeoutMs: number
  followRedirects: boolean
  maxRedirects: number
  rejectUnauthorized: boolean
  maxHistory: number
  wordWrapResponse: boolean
  sendAiContext: boolean
  autoApplyAiTools: boolean
  defaultProviderId: string | null
  /** global outbound proxy (per-request settings can override) */
  proxy: ProxyConfig
  /** client TLS certificates matched by host (paths only; bytes read in main) */
  clientCerts: ClientCert[]
  /** allow HTTP/2 negotiation for outbound requests */
  http2: boolean
}

/* ============================================================
 * AI assistant
 * ============================================================ */

export type ProviderKind = 'openai' | 'anthropic' | 'openrouter' | 'openai-compatible'

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  label: string
  /** for openai-compatible / overrides; omitted means the well-known default */
  baseUrl?: string
  /** ref into safeStorage; NEVER the raw key */
  apiKeyRef?: string
  /** whether a key has been stored (renderer hint; raw key never sent) */
  hasKey?: boolean
  defaultModel: string
  models: string[]
  extraHeaders?: Record<string, string>
  /** ui accent hue + glyph for the design's provider chips */
  hue: number
  glyph: string
  sub?: string
}

export interface ProvidersDoc extends DocEnvelope {
  providers: ProviderConfig[]
  activeProviderId: string | null
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  /** JSON-encoded arguments (OpenAI style) */
  arguments: string
}

export interface ChatMessage {
  role: ChatRole
  content: string
  toolCalls?: ToolCall[]
  /** for role:'tool' results */
  toolCallId?: string
  name?: string
}

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for parameters */
  parameters: Record<string, unknown>
}

export interface ModelInfo {
  id: string
  label?: string
}

export interface AiChatStart {
  streamId: string
  providerId: string
  model: string
  messages: ChatMessage[]
  tools?: ToolSpec[]
  temperature?: number
  maxTokens?: number
}

export type AiStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; finishReason?: string }
  | { type: 'error'; error: string }

/** Compact, secret-masked snapshot of app state injected into the prompt. */
export interface AiContextSnapshot {
  request?: {
    method: string
    url: string
    resolvedUrl?: string
    headers: { key: string; value: string }[]
    bodyType: string
    bodyPreview?: string
    authType: string
  }
  response?: {
    status: number
    statusText: string
    timeMs: number
    sizeBytes: number
    headers: { key: string; value: string }[]
    bodyPreview?: string
  }
  environment?: {
    name: string
    variableNames: string[]
  }
}

/* ============================================================
 * Scripting sandbox (P1)
 * ============================================================ */

export interface ScriptTestResult {
  name: string
  passed: boolean
  error?: string
}

export interface ScriptConsoleLine {
  level: 'log' | 'info' | 'warn' | 'error'
  message: string
}

export interface ScriptRunRequest {
  phase: 'pre-request' | 'test'
  code: string
  request: RequestModel
  /** present for test phase */
  response?: ResponseResult
  environment: Record<string, string>
  globals: Record<string, string>
  /** collection-scoped variables (read/write via pm.collectionVariables) */
  collection?: Record<string, string>
  /** data-file row for the current runner iteration (pm.iterationData) */
  iterationData?: Record<string, string>
  /** cookie snapshot for the request URL's domain, for pm.cookies (read) */
  cookies?: StoredCookie[]
  /** the request URL (for pm.cookies.jar() defaults) */
  url?: string
}

/** Payload captured from `pm.visualizer.set(template, data)` in a test script. */
export interface VisualizerPayload {
  template: string
  data: unknown
}

export interface ScriptRunResult {
  logs: ScriptConsoleLine[]
  tests: ScriptTestResult[]
  /** variable mutations to apply back */
  environmentUpdates: Record<string, string | null>
  globalUpdates: Record<string, string | null>
  /** collection-variable mutations (pm.collectionVariables.set/unset) */
  collectionUpdates?: Record<string, string | null>
  /** cookie mutations (pm.cookies.jar().set/unset) to apply to the jar */
  cookieUpdates?: { set?: StoredCookie[]; remove?: Array<Pick<StoredCookie, 'domain' | 'path' | 'key'>> }
  /** request mutations from pre-request scripts */
  requestPatch?: Partial<Pick<RequestModel, 'url' | 'headers' | 'method'>>
  /** captured Postman-style visualizer template + data (test phase) */
  visualizer?: VisualizerPayload | null
  error?: string
}

/* ============================================================
 * Import / export, codegen, dialogs, OAuth, cookies
 * ============================================================ */

export type ImportKind = 'postman' | 'openapi' | 'curl' | 'har' | 'swagger' | 'insomnia' | 'auto'

export interface ImportResult {
  kind: 'collection' | 'request' | 'environment'
  collection?: CollectionFolderNode
  request?: RequestModel
  environment?: Environment
  warnings: string[]
}

export interface FilePickResult {
  filePath: string
  fileName: string
  sizeBytes: number
}

export interface OAuthTokenRequest {
  grant: OAuth2Grant
  tokenUrl: string
  clientId: string
  clientSecret?: string
  scope?: string
  username?: string
  password?: string
  authUrl?: string
  /** authorization_code grant */
  code?: string
  redirectUri?: string
  /** PKCE code_verifier (authorization_code) */
  codeVerifier?: string
  /** refresh_token grant */
  refreshToken?: string
  /** device_code grant: the device_code returned by the device-authorization step */
  deviceCode?: string
  /** how to present client credentials: request body (default) or HTTP Basic */
  clientAuth?: 'body' | 'basic'
}

export interface OAuthTokenResult {
  ok: boolean
  accessToken?: string
  tokenType?: string
  expiresIn?: number
  /** refresh_token returned by the token endpoint, if any */
  refreshToken?: string
  raw?: string
  error?: string
}

/** Device Authorization Grant — step 1 (RFC 8628). */
export interface OAuthDeviceRequest {
  deviceAuthUrl: string
  clientId: string
  scope?: string
}

export interface OAuthDeviceResult {
  ok: boolean
  deviceCode?: string
  userCode?: string
  verificationUri?: string
  verificationUriComplete?: string
  expiresIn?: number
  interval?: number
  error?: string
}

export interface StoredCookie {
  key: string
  value: string
  domain: string
  path: string
  expires?: string
  httpOnly?: boolean
  secure?: boolean
}

export interface CookiesDoc extends DocEnvelope {
  cookies: StoredCookie[]
}

/* ============================================================
 * Realtime (WebSocket + SSE) — P2
 * ============================================================ */

export type RealtimeKind = 'websocket' | 'sse'

/** One entry in a connection's message log. */
export interface RealtimeMessage {
  id: string
  /** in = received, out = sent by us, system = lifecycle/info */
  dir: 'in' | 'out' | 'system'
  data: string
  at: number
  /** ws: 'text' | 'binary'; sse: the event name (message/ping/...) */
  kind?: string
}

/** Events streamed from main → renderer for a live connection. */
export type RealtimeEvent =
  | { type: 'open'; protocol?: string }
  | { type: 'message'; message: RealtimeMessage }
  | { type: 'close'; code?: number; reason?: string }
  | { type: 'error'; error: string }
  | { type: 'reconnecting'; attempt: number; delayMs: number }

export interface WsConnectSpec {
  connId: string
  url: string
  protocols?: string[]
  /** custom handshake headers (already variable-interpolated) */
  headers: KV[]
  rejectUnauthorized?: boolean
}

export interface SseConnectSpec {
  connId: string
  url: string
  headers: KV[]
  rejectUnauthorized?: boolean
}

export interface SocketIoConnectSpec {
  connId: string
  url: string
  /** extra handshake headers (already interpolated) */
  headers: KV[]
  /** event names to listen for; empty → listen to all events */
  listenEvents?: string[]
  rejectUnauthorized?: boolean
}

export interface MqttConnectSpec {
  connId: string
  url: string
  username?: string
  password?: string
  clientId?: string
  /** topics to subscribe to on connect */
  subscribeTopics?: string[]
  rejectUnauthorized?: boolean
  /** default QoS for publish/subscribe (0/1/2) */
  qos?: 0 | 1 | 2
  /** Last-Will and Testament published by the broker if the client drops */
  lwt?: { topic: string; payload: string; qos?: 0 | 1 | 2; retain?: boolean }
}

/** A reusable, saved realtime message (WebSocket frame / Socket.IO emit / MQTT publish). */
export interface MessageTemplate {
  id: string
  name: string
  content: string
  /** Socket.IO event name (socketio mode) */
  event?: string
  /** MQTT topic (mqtt mode) */
  topic?: string
}

/* ============================================================
 * gRPC — P2 (pure-JS @grpc/grpc-js + @grpc/proto-loader)
 * ============================================================ */

/** Streaming shape of a gRPC method, derived from the proto. */
export type GrpcMethodKind = 'unary' | 'server_stream' | 'client_stream' | 'bidi'

export interface GrpcMethodInfo {
  /** simple method name, e.g. "SayHello" */
  name: string
  /** fully-qualified "package.Service/Method" path used to invoke */
  path: string
  kind: GrpcMethodKind
  requestType: string
  responseType: string
}

export interface GrpcServiceInfo {
  /** fully-qualified service name, e.g. "helloworld.Greeter" */
  name: string
  methods: GrpcMethodInfo[]
}

/** Result of parsing a .proto document (in main, via proto-loader). */
export interface GrpcParseResult {
  services: GrpcServiceInfo[]
  error?: string
}

/** Per-request gRPC configuration persisted on the RequestModel. */
export interface GrpcConfig {
  /** raw .proto source text */
  proto?: string
  /** host:port target (no scheme) */
  address?: string
  /** selected fully-qualified service name */
  service?: string
  /** selected method name */
  method?: string
  /** streaming kind of the selected method (cached from the last parse) */
  methodKind?: GrpcMethodKind
  /** request message as JSON text (the composer draft) */
  message?: string
  /** call metadata (key/value, interpolated before invoke) */
  metadata?: KV[]
  /** use plaintext (h2c) instead of TLS */
  plaintext?: boolean
  /** discover services via gRPC Server Reflection instead of a pasted .proto */
  useReflection?: boolean
  /** per-call deadline in milliseconds (0/undefined = none) */
  deadlineMs?: number
  /** mTLS: PEM paths (read in main only) */
  caCertPath?: string
  clientCertPath?: string
  clientKeyPath?: string
}

/** Discover services/methods from a running server via gRPC Server Reflection. */
export interface GrpcReflectSpec {
  address: string
  metadata: KV[]
  plaintext?: boolean
  rejectUnauthorized?: boolean
  caCertPath?: string
  clientCertPath?: string
  clientKeyPath?: string
}

/** Start a gRPC call. Streams results over `grpc:event:<connId>`. */
export interface GrpcInvokeSpec {
  connId: string
  proto: string
  address: string
  /** fully-qualified service name */
  service: string
  /** method name within the service */
  method: string
  /** request message JSON (unary / client-stream first message) */
  message: string
  metadata: KV[]
  plaintext?: boolean
  rejectUnauthorized?: boolean
  /** discover descriptors via Server Reflection instead of `proto` */
  useReflection?: boolean
  /** per-call deadline in milliseconds (0/undefined = none) */
  deadlineMs?: number
  /** mTLS: PEM paths (read in main only) */
  caCertPath?: string
  clientCertPath?: string
  clientKeyPath?: string
}

/* ============================================================
 * Local workspaces — P2
 * ============================================================ */

export interface WorkspaceMeta {
  id: string
  name: string
}

/** Root-level meta file (outside per-workspace data) tracking the workspace set. */
export interface WorkspacesDoc {
  version: number
  workspaces: WorkspaceMeta[]
  activeWorkspaceId: string
}

/* ============================================================
 * SQLite backup (optional, pure-WASM sql.js) — P2
 * The JSON store stays the canonical backend (CLAUDE.md); this is an
 * import/export of a workspace's data to a portable .sqlite file.
 * ============================================================ */

export interface SqliteSnapshot {
  collections: CollectionFolderNode[]
  environments: Environment[]
  activeEnvironmentId: string | null
  globals: VariableDef[]
  history: HistoryEntry[]
}

export interface SqliteImportSummary {
  collections: number
  requests: number
  environments: number
  globals: number
  history: number
}

/* ============================================================
 * GraphQL schema introspection — P2
 * ============================================================ */

export interface GraphqlField {
  name: string
  /** rendered type, e.g. "String!" or "[User!]" */
  type: string
  args: { name: string; type: string }[]
  description?: string
}

export interface GraphqlTypeInfo {
  name: string
  kind: string
  description?: string
  fields: GraphqlField[]
}

export interface GraphqlSchema {
  queryType?: string
  mutationType?: string
  subscriptionType?: string
  types: GraphqlTypeInfo[]
}

export interface GraphqlIntrospectResult {
  ok: boolean
  schema?: GraphqlSchema
  error?: string
}
