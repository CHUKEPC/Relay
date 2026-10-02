import { describe, expect, it } from 'vitest'
import { appendCapped, MAX_MESSAGES, systemMessage } from './message-log'

describe('realtime / gRPC message log', () => {
  it('appends without touching the original list', () => {
    const before = [systemMessage('a')]
    const after = appendCapped(before, systemMessage('b'))
    expect(before.map((m) => m.data)).toEqual(['a'])
    expect(after.map((m) => m.data)).toEqual(['a', 'b'])
  })

  it('drops the oldest messages past the cap', () => {
    let log = Array.from({ length: MAX_MESSAGES }, (_, i) => systemMessage(String(i)))
    log = appendCapped(log, systemMessage('new'))
    expect(log).toHaveLength(MAX_MESSAGES)
    expect(log[0].data).toBe('1')
    expect(log[log.length - 1].data).toBe('new')
  })

  it('marks app-written lines as system messages', () => {
    const m = systemMessage('Connected')
    expect(m).toMatchObject({ dir: 'system', kind: 'system', data: 'Connected' })
    expect(m.id).not.toBe(systemMessage('Connected').id)
  })
})
