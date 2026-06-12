import type { CSSProperties } from 'react'

/** 1.6px-stroke icon set on a 20px grid, ported from the Relay design. */
const PATHS: Record<string, string> = {
  collections: 'M3 5.5A1.5 1.5 0 0 1 4.5 4H8l1.5 1.5H17a1 1 0 0 1 1 1V8M3 5.5V15a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8M3 5.5 3 8',
  history: 'M3 10a7 7 0 1 0 2.3-5.2M3 4v3h3M10 6.5V10l2.5 1.5',
  env: 'M10 2.5 17 6v8l-7 3.5L3 14V6l7-3.5ZM3.2 6 10 9.5 16.8 6M10 9.5V17',
  search: 'M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12ZM17 17l-3.6-3.6',
  chevR: 'M7.5 5l4 5-4 5',
  chevD: 'M5 7.5l5 4 5-4',
  chevDsm: 'M4 6.5l4 3.5 4-3.5',
  folder: 'M3 6a1.5 1.5 0 0 1 1.5-1.5H8L9.5 6H16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z',
  plus: 'M10 4v12M4 10h12',
  send: 'M3.5 10 17 3.5 13 17l-3-5-6.5-2Z',
  sparkle: 'M10 2.5l1.6 4.3 4.4 1.7-4.4 1.7L10 14.5 8.4 10.2 4 8.5l4.4-1.7L10 2.5ZM15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z',
  close: 'M5 5l10 10M15 5L5 15',
  sun: 'M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM10 1.5v2M10 16.5v2M3.5 3.5l1.4 1.4M15.1 15.1l1.4 1.4M1.5 10h2M16.5 10h2M3.5 16.5l1.4-1.4M15.1 4.9l1.4-1.4',
  moon: 'M16 11.5A6.5 6.5 0 0 1 8.5 4a5 5 0 1 0 7.5 7.5Z',
  settings:
    'M10 12.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6ZM16.2 12.3a1.2 1.2 0 0 0 .24 1.32l.04.04a1.45 1.45 0 1 1-2.05 2.05l-.04-.04a1.2 1.2 0 0 0-2.04.85V17a1.45 1.45 0 0 1-2.9 0v-.07a1.2 1.2 0 0 0-2.04-.81l-.04.04a1.45 1.45 0 1 1-2.05-2.05l.04-.04a1.2 1.2 0 0 0-.85-2.04H3.5a1.45 1.45 0 0 1 0-2.9h.07a1.2 1.2 0 0 0 .81-2.04l-.04-.04A1.45 1.45 0 1 1 6.4 3.95l.04.04a1.2 1.2 0 0 0 1.32.24h.06a1.2 1.2 0 0 0 .73-1.1V3.5a1.45 1.45 0 0 1 2.9 0v.07a1.2 1.2 0 0 0 2.04.81l.04-.04a1.45 1.45 0 1 1 2.05 2.05l-.04.04a1.2 1.2 0 0 0-.24 1.32v.06a1.2 1.2 0 0 0 1.1.73h.07a1.45 1.45 0 0 1 0 2.9H17a1.2 1.2 0 0 0-1.1.73Z',
  copy: 'M7 7V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5v7A1.5 1.5 0 0 1 15.5 13H13M4.5 7h7A1.5 1.5 0 0 1 13 8.5v7A1.5 1.5 0 0 1 11.5 17h-7A1.5 1.5 0 0 1 3 15.5v-7A1.5 1.5 0 0 1 4.5 7Z',
  check: 'M4 10.5l3.5 3.5 8.5-9',
  dots: 'M5 10h.01M10 10h.01M15 10h.01',
  play: 'M5.5 3.5v13l11-6.5-11-6.5Z',
  trash: 'M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6M6 6l.6 9a1.5 1.5 0 0 0 1.5 1.4h3.8a1.5 1.5 0 0 0 1.5-1.4L15 6',
  bolt: 'M11 2.5 4 11h5l-1 6.5L15 9h-5l1-6.5Z',
  link: 'M8.5 11.5a2.5 2.5 0 0 0 3.6.1l2.4-2.4a2.55 2.55 0 0 0-3.6-3.6l-1.1 1.1M11.5 8.5a2.5 2.5 0 0 0-3.6-.1l-2.4 2.4a2.55 2.55 0 0 0 3.6 3.6l1.1-1.1',
  grid: 'M4 4h5v5H4V4ZM11 4h5v5h-5V4ZM4 11h5v5H4v-5ZM11 11h5v5h-5v-5Z',
  arrowR: 'M4 10h12M11 5l5 5-5 5',
  doc: 'M5 3.5h6L15 7v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1ZM11 3.5V7h4M7.5 11h5M7.5 13.5h5',
  cookie: 'M10 3a7 7 0 1 0 7 7 3 3 0 0 1-3-3 3 3 0 0 1-3-3 3.5 3.5 0 0 0-1-1ZM7 9h.01M9.5 12.5h.01M12.5 10.5h.01',
  save: 'M4.5 3.5h8L16 7v8.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 .5-1ZM6.5 3.5v4h6M7 16.5v-4h6v4',
  enter: 'M16 4v5a2 2 0 0 1-2 2H4M7 8l-3 3 3 3',
  key: 'M12.5 3a4.5 4.5 0 0 0-4.3 5.8L3 14v3h3v-2h2v-2h2l1.2-1.2A4.5 4.5 0 1 0 12.5 3ZM14 7h.01',
  warn: 'M10 3 18 16.5H2L10 3ZM10 8v4M10 14.5h.01',
  info: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM10 9v4M10 6.5h.01',
  sidebar: 'M3.5 4.5h13a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM8 4.5v11',
  filter: 'M3 5h14l-5.5 6.5V16l-3 1.5v-6L3 5Z',
  refresh: 'M16 4v4h-4M4 16v-4h4M16.5 8a6.5 6.5 0 0 0-11-2.5L4 8M3.5 12a6.5 6.5 0 0 0 11 2.5L16 12',
  eye: 'M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10ZM10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  stop: 'M6.5 6.5h7v7h-7z',
  code2: 'M7 6 3 10l4 4M13 6l4 4-4 4',
  download: 'M10 3v9M6 8.5l4 4 4-4M4 16h12',
  upload: 'M10 13V4M6 7.5l4-4 4 4M4 16h12',
  winMin: 'M4 10h12',
  winMax: 'M5.5 5.5h9v9h-9z',
  book: 'M10 6.5C8.4 5 6.2 4.5 3 4.5v11c3.2 0 5.4.5 7 2 1.6-1.5 3.8-2 7-2v-11c-3.2 0-5.4.5-7 2ZM10 6.5v11',
  layoutGrid: 'M3.5 3.5H9V9H3.5V3.5ZM11 3.5h5.5V9H11V3.5ZM3.5 11H9v5.5H3.5V11ZM11 11h5.5v5.5H11V11Z',
  dockBottom: 'M3.5 4.5h13a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM2.5 11.5h15M5.5 13.5h9',
  dockLeft: 'M3.5 4.5h13a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM7 4.5v11M4.5 7.5h.8M4.5 10h.8',
  dockRight: 'M3.5 4.5h13a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM13 4.5v11M14.7 7.5h.8M14.7 10h.8',
  floatWin: 'M7 7V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M4 7h8a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z',
  pencil: 'M3.5 16.5l.6-3.1L13.6 4a1.9 1.9 0 0 1 2.7 2.7l-9.5 9.4-3.3.4ZM12.3 5.3l2.7 2.7',
  mail: 'M3.5 5h13a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3 6l7 5.5L17 6'
}

const FILLED: Record<string, boolean> = { send: true, play: true, sparkle: true, bolt: true, stop: true }

export interface IconProps {
  name: keyof typeof PATHS | string
  size?: number
  className?: string
  style?: CSSProperties
  strokeWidth?: number
}

export function Icon({ name, size = 16, className = '', style, strokeWidth }: IconProps) {
  const d = PATHS[name] ?? PATHS.info
  const filled = FILLED[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      className={className}
      style={style}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth ?? 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  )
}
