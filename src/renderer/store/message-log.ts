import { makeId } from '@shared/id'
import type { RealtimeMessage } from '@shared/types'

/** How many messages a realtime or gRPC tab keeps; older ones are dropped. */
export const MAX_MESSAGES = 2000

/** A line the app writes into a tab's message log itself (connected, closed, …). */
export function systemMessage(text: string): RealtimeMessage {
  return { id: makeId('rt'), dir: 'system', data: text, at: Date.now(), kind: 'system' }
}

/** `messages` with `msg` added at the end, capped at MAX_MESSAGES. */
export function appendCapped(messages: RealtimeMessage[], msg: RealtimeMessage): RealtimeMessage[] {
  const next = [...messages, msg]
  if (next.length > MAX_MESSAGES) next.splice(0, next.length - MAX_MESSAGES)
  return next
}
