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
export type OAuth2Grant = 'authorization_code' | 'client_credentials' | 'password'

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
    }
  | { type: 'digest'; username: string; password: string; algorithm?: 'MD5' | 'SHA-256' }

export interface RequestSettings {
  timeoutMs: number
  followRedirects: boolean
  maxRedirects: number
  rejectUnauthorized: boolean
  encodeUrl?: boolean
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
  /** collection-scoped variables (read-only via pm.variables) */
  collection?: Record<string, string>
}

export interface ScriptRunResult {
  logs: ScriptConsoleLine[]
  tests: ScriptTestResult[]
  /** variable mutations to apply back */
  environmentUpdates: Record<string, string | null>
  globalUpdates: Record<string, string | null>
  /** request mutations from pre-request scripts */
  requestPatch?: Partial<Pick<RequestModel, 'url' | 'headers' | 'method'>>
  error?: string
}

/* ============================================================
 * Import / export, codegen, dialogs, OAuth, cookies
 * ============================================================ */

export type ImportKind = 'postman' | 'openapi' | 'curl' | 'auto'

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
}

export interface OAuthTokenResult {
  ok: boolean
  accessToken?: string
  tokenType?: string
  expiresIn?: number
  raw?: string
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
