/** Smallest slider thumb, so a very long row still has something to grab. */
export const MIN_THUMB = 28

export interface ScrollState {
  /** scrollLeft */
  left: number
  /** scrollWidth */
  width: number
  /** clientWidth */
  view: number
}

export interface Slider {
  /** the row is wider than its box */
  overflow: boolean
  /** content hidden past the start / the end */
  canStart: boolean
  canEnd: boolean
  /** thumb width and offset along the track, px */
  thumb: number
  offset: number
  /** scroll px per px of thumb travel */
  ratio: number
}

/** Where the slider of a sideways-scrolling row (HScroll) stands for `s`. */
export function sliderOf(s: ScrollState): Slider {
  const overflow = s.width > s.view + 1
  if (!overflow) return { overflow, canStart: false, canEnd: false, thumb: 0, offset: 0, ratio: 1 }
  const thumb = Math.min(s.view, Math.max(MIN_THUMB, (s.view * s.view) / s.width))
  const travel = Math.max(1, s.view - thumb)
  const range = s.width - s.view
  const left = Math.min(Math.max(s.left, 0), range)
  return {
    overflow,
    canStart: left > 1,
    canEnd: left < range - 1,
    thumb,
    offset: (left / range) * travel,
    ratio: range / travel
  }
}
