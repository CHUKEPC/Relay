import { useEffect, useState } from 'react'

/**
 * Convert any CSS color (incl. oklch) to #rrggbb via a 1px canvas.
 * `behind` flattens translucent colors against a backdrop (e.g. --line over --bg-0).
 */
export function cssColorToHex(css: string, behind?: string): string | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    if (behind) {
      ctx.fillStyle = behind
      ctx.fillRect(0, 0, 1, 1)
    }
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    if (d[3] === 0) return null
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

export function normalizeHex(value: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(value.trim())
  return m ? '#' + m[1].toLowerCase() : null
}

/** A colour picker with a hex field beside it. */
export function ColorRow(props: {
  label: string
  value: string
  onChange: (hex: string) => void
}): JSX.Element {
  const { label, value, onChange } = props
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className="cte-row">
      <span className="cte-label">{label}</span>
      <input
        type="color"
        className="cte-color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
      <input
        className="cte-hex"
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          const hex = normalizeHex(e.target.value)
          if (hex) onChange(hex)
        }}
        onBlur={() => setText(value)}
      />
    </div>
  )
}

