/**
 * Drawing app icons (src/shared/app-icon.ts) on a canvas: the shape filled with
 * its gradient, a faint light rim, and the glyph or letter on top — the same
 * build as the original Relay icon. A user's picture is drawn as it is.
 */
import { ICON_GLYPHS, type AppIconDef, type IconShape } from '@shared/app-icon'

/** Size of the PNG handed to the main process (windows, Dock, shortcuts). */
export const APP_ICON_PX = 256

/** Margin around the shape, as in the shipped icon (44 of 1024). */
const MARGIN = 0.043

function shapePath(shape: IconShape, s: number): Path2D {
  const m = s * MARGIN
  const w = s - 2 * m
  const p = new Path2D()
  switch (shape) {
    case 'circle':
      p.arc(s / 2, s / 2, w / 2, 0, Math.PI * 2)
      break
    case 'square':
      p.roundRect(m, m, w, w, w * 0.1)
      break
    case 'hexagon': {
      // Pointy top; the corners are softened by the rim stroke.
      const r = w / 2
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3
        const x = s / 2 + r * Math.cos(a)
        const y = s / 2 + r * Math.sin(a)
        if (i === 0) p.moveTo(x, y)
        else p.lineTo(x, y)
      }
      p.closePath()
      break
    }
    default:
      p.roundRect(m, m, w, w, w * 0.267)
  }
  return p
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = src
  })
}

const LETTER_FONT = (px: number): string => `700 ${px}px Inter, "Segoe UI", system-ui, sans-serif`

/** Draw `def` at `size`×`size` pixels. */
export async function drawAppIcon(def: AppIconDef, size: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.imageSmoothingQuality = 'high'

  if (def.image) {
    ctx.drawImage(await loadImage(def.image), 0, 0, size, size)
    return canvas
  }

  const shape = shapePath(def.shape, size)
  const stops = def.background.length ? def.background : ['#5a8dff']
  // Light from the top-left, like the shipped icon.
  const g = ctx.createLinearGradient(size * 0.3, 0, size * 0.7, size)
  stops.forEach((c, i) => g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c))
  if (stops.length === 1) g.addColorStop(1, stops[0])
  ctx.fillStyle = g
  ctx.fill(shape)

  ctx.save()
  ctx.clip(shape)
  ctx.lineWidth = size * 0.022
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.lineJoin = 'round'
  ctx.stroke(shape)
  ctx.restore()

  if (def.glyph === 'letter' && def.letter) {
    const px = Math.round(size * (def.letter.length > 1 ? 0.4 : 0.52))
    try {
      await document.fonts?.load(LETTER_FONT(px), def.letter)
    } catch {
      // the system font is fine too
    }
    ctx.fillStyle = def.glyphColor
    ctx.font = LETTER_FONT(px)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    const m = ctx.measureText(def.letter)
    // Centre on the ink, not on the em box.
    ctx.fillText(def.letter, size / 2, size / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2)
    return canvas
  }

  const glyph = ICON_GLYPHS[def.glyph] ?? ICON_GLYPHS.bolt
  // The glyph grid is 20 units; its drawing spans about 15 of them.
  const k = (size * 0.55) / 15
  ctx.save()
  ctx.translate(size / 2, size / 2)
  ctx.scale(k, k)
  ctx.translate(-10, -10)
  const path = new Path2D(glyph.d)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (glyph.fill) {
    ctx.fillStyle = def.glyphColor
    ctx.strokeStyle = def.glyphColor
    ctx.lineWidth = 1.1 // rounds the corners, like the shipped bolt
    ctx.fill(path)
    ctx.stroke(path)
  } else {
    ctx.strokeStyle = def.glyphColor
    ctx.lineWidth = 1.9
    ctx.stroke(path)
  }
  ctx.restore()
  return canvas
}

/** `def` as a PNG data URL. */
export async function appIconDataUrl(def: AppIconDef, size = APP_ICON_PX): Promise<string> {
  return (await drawAppIcon(def, size)).toDataURL('image/png')
}

/**
 * A picture file (PNG, JPEG, SVG, WebP, ICO, …) as an icon image: fitted into
 * a 256×256 square, centred, transparent around it.
 */
export async function pictureToIconPng(src: string): Promise<string> {
  const img = await loadImage(src)
  const w = img.naturalWidth || img.width || APP_ICON_PX
  const h = img.naturalHeight || img.height || APP_ICON_PX
  const canvas = document.createElement('canvas')
  canvas.width = APP_ICON_PX
  canvas.height = APP_ICON_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.imageSmoothingQuality = 'high'
  const k = Math.min(APP_ICON_PX / w, APP_ICON_PX / h)
  const dw = w * k
  const dh = h * k
  ctx.drawImage(img, (APP_ICON_PX - dw) / 2, (APP_ICON_PX - dh) / 2, dw, dh)
  return canvas.toDataURL('image/png')
}
