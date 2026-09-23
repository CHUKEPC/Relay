import { describe, expect, it } from 'vitest'
import { oppositeEdge, zoneAt } from './dock'

const rect = { left: 100, top: 50, right: 1100, bottom: 650, width: 1000, height: 600 } as DOMRect
const ALL = ['left', 'right', 'top', 'bottom'] as const

describe('zoneAt', () => {
  it('docks near each allowed edge', () => {
    expect(zoneAt(rect, 110, 300, ALL)).toBe('left')
    expect(zoneAt(rect, 1090, 300, ALL)).toBe('right')
    expect(zoneAt(rect, 600, 640, ALL)).toBe('bottom')
    expect(zoneAt(rect, 600, 60, ALL)).toBe('top')
  })

  it('has no zone in the middle or outside — dropping there cancels, floating is a button', () => {
    expect(zoneAt(rect, 600, 350, ALL)).toBeNull()
    expect(zoneAt(rect, 50, 300, ALL)).toBeNull()
  })

  it('ignores edges the panel may not take', () => {
    expect(zoneAt(rect, 600, 60, ['left', 'right', 'bottom'])).toBeNull()
  })

  it('resolves a corner to the nearest edge', () => {
    expect(zoneAt(rect, 105, 640, ALL)).toBe('left')
    expect(zoneAt(rect, 130, 648, ALL)).toBe('bottom')
  })

  it('caps the edge band in a very large container', () => {
    const big = { left: 0, top: 0, right: 4000, bottom: 2000, width: 4000, height: 2000 } as DOMRect
    expect(zoneAt(big, 300, 1000, ALL)).toBeNull()
    expect(zoneAt(big, 200, 1000, ALL)).toBe('left')
  })
})

describe('oppositeEdge', () => {
  it('mirrors every edge', () => {
    expect(oppositeEdge('left')).toBe('right')
    expect(oppositeEdge('right')).toBe('left')
    expect(oppositeEdge('top')).toBe('bottom')
    expect(oppositeEdge('bottom')).toBe('top')
  })
})
