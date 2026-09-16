/**
 * Feature plugins — the packs that ship next to the app in `plugins/`.
 *
 * The base app is deliberately small: HTTP requests, the six common auth
 * schemes, Russian and English, up to four panes. Everything beyond that is a
 * *capability* declared by a plugin folder. Removing the folder removes the
 * feature; disabling the plugin hides it until it is enabled again.
 *
 * These plugins are declarative only — a manifest and (for languages) data
 * files. They never execute code, which is what separates them from the user
 * plugin system in `src/main/plugins` (sandboxed, permission-gated mods).
 */

/** Everything the base app can be extended with. */
export const CAPABILITIES = [
  'protocol.websocket',
  'protocol.sse',
  'protocol.socketio',
  'protocol.mqtt',
  'protocol.grpc',
  'ai',
  'auth.advanced',
  'i18n.extra',
  'panes.extra',
  'backup.extra'
] as const

export type Capability = (typeof CAPABILITIES)[number]

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value)
}

/** `plugin.json` of a feature plugin. */
export interface FeaturePluginManifest {
  id: string
  name: string
  description: string
  version: string
  capabilities: Capability[]
  /** BCP-47 codes of UI languages this plugin adds (`i18n.extra` only) */
  locales?: string[]
}

/** A manifest plus the runtime state the UI needs. */
export interface FeaturePluginInfo extends FeaturePluginManifest {
  enabled: boolean
  /** absolute folder path (display only) */
  dir: string
  /** validation or read error; a broken plugin can never be enabled */
  error?: string
}

/** Protocol modes that are not part of the base app. */
export const PROTOCOL_CAPABILITY: Record<string, Capability> = {
  websocket: 'protocol.websocket',
  sse: 'protocol.sse',
  socketio: 'protocol.socketio',
  mqtt: 'protocol.mqtt',
  grpc: 'protocol.grpc'
}

/** Auth schemes the base app always offers. */
export const CORE_AUTH_TYPES = ['inherit', 'none', 'bearer', 'basic', 'apikey', 'oauth2'] as const

/** UI languages the base app always offers. */
export const CORE_LOCALES = ['ru', 'en'] as const

/** Capabilities of an app running with no plugins at all. */
export const NO_CAPABILITIES: readonly Capability[] = []
