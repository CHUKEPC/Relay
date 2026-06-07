import type { MessageTemplate } from '@shared/types'
import type { RtKind } from '@renderer/store/realtime'

/**
 * Saved message templates that apply to a given realtime kind.
 *
 * SSE has no outbound channel, so it never exposes templates. Other kinds
 * (WebSocket / Socket.IO / MQTT) share the same flat list — the optional
 * `event`/`topic` fields on a template are only meaningful for their respective
 * kinds and are simply ignored where they don't apply.
 */
export function templatesForKind(templates: MessageTemplate[] | undefined, kind: RtKind): MessageTemplate[] {
  if (kind === 'sse') return []
  return templates ?? []
}
