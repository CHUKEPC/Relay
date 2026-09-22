/**
 * Product-wide constants. The product name lives here and in package.json
 * (`productName`) — the only two places to rename the app.
 */
export const APP_NAME = 'Relay'
export const APP_ID = 'com.relay.apiclient'
/** Keep in sync with package.json `version`. */
export const APP_VERSION = '1.2.0'
export const FEEDBACK_EMAIL = 'semend2005@mail.ru'
/** Author contacts shown next to the feedback address in About. */
export const FEEDBACK_GITHUB = 'https://github.com/Laki-man3'
export const FEEDBACK_TELEGRAM = 'https://t.me/PowerOfNsk'
/**
 * GitHub owner/repo used for release update checks; placeholder until the app
 * is published — the checker must fail gracefully.
 */
export const UPDATE_REPO = 'CHUKEPC/Relay'

/** The plugin authoring guide on GitHub (docs/plugin-guide), per UI language. */
export const PLUGIN_GUIDE_URL = {
  ru: `https://github.com/${UPDATE_REPO}/blob/main/docs/plugin-guide/README.ru.md`,
  en: `https://github.com/${UPDATE_REPO}/blob/main/docs/plugin-guide/README.md`
}

export const STORAGE_VERSION = 1

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

export const DEFAULT_SETTINGS = {
  theme: 'system' as 'light' | 'dark' | 'system',
  accentHue: 264,
  requestTimeoutMs: 30000,
  followRedirects: true,
  maxRedirects: 10,
  rejectUnauthorized: true,
  maxHistory: 200,
  wordWrapResponse: false,
  sendAiContext: true,
  autoApplyAiTools: false,
  proxy: { enabled: false, url: '', bypass: [] as string[] },
  clientCerts: [] as import('./types').ClientCert[],
  http2: false
}

export type AppSettings = typeof DEFAULT_SETTINGS

/** Content-Type mapping for the raw-body language selector. */
export const RAW_LANGUAGE_CONTENT_TYPE: Record<string, string> = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  html: 'text/html',
  javascript: 'application/javascript'
}

/** Body kept small for AI context injection. */
export const AI_CONTEXT_BODY_LIMIT = 6000

/** Common header names for autocomplete in the headers editor. */
export const COMMON_HEADER_NAMES = [
  'Accept',
  'Accept-Encoding',
  'Accept-Language',
  'Authorization',
  'Cache-Control',
  'Content-Type',
  'Cookie',
  'Host',
  'Origin',
  'Referer',
  'User-Agent',
  'X-Api-Key',
  'X-Request-Id',
  'If-None-Match',
  'If-Modified-Since',
  'Idempotency-Key',
  'Content-Length',
  'Connection'
]

/** Common Content-Type values for value autocomplete. */
export const COMMON_CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'text/html',
  'application/octet-stream'
]
