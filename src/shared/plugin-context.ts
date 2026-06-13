/**
 * Pure mappers that build the (un-redacted) plugin event context from engine
 * types. Shared by the renderer (button click) and main (response hook) so the
 * ResponseResult→snapshot shape lives in ONE place — the security-sensitive
 * redaction/grant-filtering then happens once, in the main process
 * (`PluginManager.sanitizeContext`). No Node/DOM deps.
 */
import type { KV, PluginRequestSnapshot, PluginResponseSnapshot, ResponseResult } from './types'

/** Map a completed engine response to the plugin response snapshot (pre-redaction). */
export function responseSnapshotForPlugin(result: ResponseResult): PluginResponseSnapshot {
  return {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
    contentType: result.body.contentType,
    bodyText: result.body.isBinary ? undefined : result.body.text,
    sizeBytes: result.body.sizeBytes,
    timeMs: result.timings.totalMs,
    finalUrl: result.finalUrl
  }
}

/** Map a request's method/url/enabled-headers to the plugin request snapshot. */
export function requestSnapshotForPlugin(
  method: string,
  url: string,
  headers: KV[]
): PluginRequestSnapshot {
  return {
    method,
    url,
    headers: headers.filter((h) => h.enabled).map((h) => ({ key: h.key, value: h.value }))
  }
}
