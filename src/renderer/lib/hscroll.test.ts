import { describe, expect, it } from 'vitest'
import { MIN_THUMB, sliderOf } from './hscroll'

describe('sliderOf', () => {
  it('shows nothing when the row fits', () => {
    expect(sliderOf({ left: 0, width: 300, view: 300 })).toMatchObject({ overflow: false, canStart: false, canEnd: false, thumb: 0 })
    // a sub-pixel difference is rounding, not overflow
    expect(sliderOf({ left: 0, width: 300.6, view: 300 }).overflow).toBe(false)
  })

  it('sizes the thumb by the visible share of the row', () => {
    const s = sliderOf({ left: 0, width: 800, view: 400 })
    expect(s.thumb).toBe(200)
    expect(s.offset).toBe(0)
    expect(s.canStart).toBe(false)
    expect(s.canEnd).toBe(true)
  })

  it('keeps a thumb that can be grabbed on a very long row', () => {
    expect(sliderOf({ left: 0, width: 100000, view: 200 }).thumb).toBe(MIN_THUMB)
  })

  it('moves the thumb to the end of the track at the end of the row', () => {
    const s = sliderOf({ left: 400, width: 800, view: 400 })
    expect(s.offset).toBe(200)
    expect(s.canStart).toBe(true)
    expect(s.canEnd).toBe(false)
  })

  it('maps thumb travel back to scroll distance', () => {
    const s = sliderOf({ left: 100, width: 1000, view: 250 })
    // dragging the thumb across its whole travel scrolls the whole range
    expect((250 - s.thumb) * s.ratio).toBeCloseTo(750)
    expect(s.offset * s.ratio).toBeCloseTo(100)
  })

  it('clamps an overscrolled position', () => {
    expect(sliderOf({ left: -20, width: 800, view: 400 }).offset).toBe(0)
    expect(sliderOf({ left: 9999, width: 800, view: 400 }).offset).toBe(200)
  })
})
