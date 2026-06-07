import { describe, expect, it } from 'vitest'
import type { MessageTemplate } from '@shared/types'
import { templatesForKind } from './templates'

const list: MessageTemplate[] = [
  { id: '1', name: 'ping', content: 'ping' },
  { id: '2', name: 'login', content: '{"u":"a"}', event: 'login' },
  { id: '3', name: 'temp', content: '21.5', topic: 'sensors/temp' }
]

describe('templatesForKind', () => {
  it('returns no templates for SSE (no outbound channel)', () => {
    expect(templatesForKind(list, 'sse')).toEqual([])
  })

  it('returns the full list for WebSocket / Socket.IO / MQTT', () => {
    expect(templatesForKind(list, 'websocket')).toBe(list)
    expect(templatesForKind(list, 'socketio')).toBe(list)
    expect(templatesForKind(list, 'mqtt')).toBe(list)
  })

  it('treats undefined as an empty list', () => {
    expect(templatesForKind(undefined, 'mqtt')).toEqual([])
    expect(templatesForKind(undefined, 'sse')).toEqual([])
  })
})
