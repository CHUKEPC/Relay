import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import type { SettingsDoc } from '@shared/types'
import { APP_VERSION } from '@shared/constants'
import { Icon } from '@renderer/components/Icon'
import { useSettings } from '@renderer/store/settings'
import { kbd } from '@renderer/lib/platform'
import { clamp } from '@renderer/lib/math'
import { tr, trf } from '@renderer/lib/i18n'
import '@renderer/styles/feat-tour.css'

interface TourStep {
  /** CSS selector of the anchor element to spotlight. */
  target: string
  title: string
  /** translated at render; `{key}` is replaced with the platform shortcut */
  body: string
  /** shortcut letter for the `{key}` placeholder, if the body has one */
  keyHint?: string
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="search"]',
    title: 'Поиск и команды',
    body: 'Глобальный поиск по запросам, коллекциям и командам. Открывается в любой момент — {key}.',
    keyHint: 'K'
  },
  {
    target: '.tabstrip',
    title: 'Вкладки запросов',
    body: 'Каждый запрос живёт в своей вкладке. Правый клик по вкладке открывает меню действий: дублировать, закрыть остальные и не только.'
  },
  {
    target: '[data-tour="send"]',
    title: 'Адрес и отправка',
    body: 'Выберите метод, введите URL и нажмите «Отправить» — или {key}.',
    keyHint: 'Enter'
  },
  {
    target: '[data-tour="save"]',
    title: 'Сохранение',
    body: 'Сохраните запрос в коллекцию, чтобы вернуться к нему позже — {key}.',
    keyHint: 'S'
  },
  {
    target: '[data-tour="nav"]',
    title: 'Коллекции, история, окружения',
    body: 'Боковая панель переключается между коллекциями, историей отправленных запросов и окружениями.'
  },
  {
    target: '.panel-dock-head',
    title: 'Панели двигаются',
    body: 'Потяните заголовок панели к краю окна — она закрепится слева, справа или снизу, а панель, стоявшая там, поменяется с ней местами. Запрос и ответ так же переставляются внутри своей панели — за ручки в заголовках. Плавающей панель делает кнопка.'
  },
  {
    target: '[data-tour="env"]',
    title: 'Окружения и переменные',
    body: 'Здесь выбирается активное окружение. Переменные вида {{var}} подставляются в URL, заголовки и тело перед отправкой.'
  },
  {
    target: '[data-tour="runner"]',
    title: 'Раннер коллекций',
    body: 'Прогон коллекции, папки или отмеченного набора запросов: итерации, файл данных CSV/JSON, тесты и отчёт по результатам — {key}.',
    keyHint: 'Shift+R'
  },
  {
    target: '[data-tour="find"]',
    title: 'Поиск и замена',
    body: 'Поиск по всем коллекциям, окружениям и переменным — с заменой там, где вы её подтвердите. Пригодится, чтобы разом сменить домен или версию API — {key}.',
    keyHint: 'Shift+F'
  },
  {
    target: '[data-tour="console"]',
    title: 'Консоль',
    body: 'Лог всех отправленных запросов с заголовками и таймингами. Консоль закрепляется снизу, слева, справа или плавает над окном.'
  },
  {
    target: '[data-tour="ai"]',
    title: 'AI-ассистент',
    body: 'Подключите своего провайдера — OpenAI, Anthropic, OpenRouter или локальную модель — и ассистент поможет с запросами и тестами.'
  },
  {
    target: '[data-tour="settings"]',
    title: 'Настройки',
    body: 'Темы и свои темы из файла, режим для слабых ПК, плагины, горячие клавиши и справка. Тур можно перезапустить в разделе «Справка».'
  }
]

/* Direction of the last navigation: missing anchors are skipped the same way,
 * so «Назад» can step backwards over a hidden control instead of bouncing. */
let travelDir: 1 | -1 = 1

interface TourState {
  active: boolean
  step: number
  start: () => void
  stop: () => void
  next: () => void
  prev: () => void
}

export const useTour = create<TourState>((set, get) => ({
  active: false,
  step: 0,
  start: () => {
    travelDir = 1
    set({ active: true, step: 0 })
  },
  stop: () => {
    if (!get().active) return
    set({ active: false })
    // Finishing OR skipping both count as "seen" — never auto-show again for
    // this major version (see shouldShowTour).
    useSettings.getState().update({ onboardingDone: true, onboardingVersion: APP_VERSION })
  },
  next: () => {
    travelDir = 1
    const { step } = get()
    if (step >= STEPS.length - 1) get().stop()
    else set({ step: step + 1 })
  },
  prev: () => {
    travelDir = -1
    set((s) => ({ step: Math.max(0, s.step - 1) }))
  }
}))

/** Imperative entry point — used by App bootstrap and the restart buttons. */
export function startTour(): void {
  useTour.getState().start()
}

/**
 * Show the tour on a first run — and once more after a major upgrade, since
 * that is where new things to point at land. Upgrading 1.0.1 → 1.0.2 never
 * re-opens it.
 */
export function shouldShowTour(settings: Pick<SettingsDoc, 'onboardingDone' | 'onboardingVersion'>): boolean {
  if (!settings.onboardingDone) return true
  const major = (v: string): string => v.split('.')[0] ?? ''
  return major(settings.onboardingVersion ?? '') !== major(APP_VERSION)
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const SPOT_PAD = 6
const CARD_GAP = 12
const EDGE = 10

function findTarget(stepIndex: number): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(STEPS[stepIndex].target)
  if (!el) return null
  const r = el.getBoundingClientRect()
  // Present in the DOM but collapsed/hidden counts as missing.
  if (r.width <= 0 && r.height <= 0) return null
  return el
}

function padRect(r: DOMRect): Rect {
  return { top: r.top - SPOT_PAD, left: r.left - SPOT_PAD, width: r.width + SPOT_PAD * 2, height: r.height + SPOT_PAD * 2 }
}

export function Tour(): JSX.Element | null {
  const active = useTour((s) => s.active)
  const step = useTour((s) => s.step)
  const [rect, setRect] = useState<Rect | null>(null)
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Resolve the anchor for the current step; skip missing anchors silently.
  useEffect(() => {
    if (!active) {
      setRect(null)
      setCardPos(null)
      return
    }
    const el = findTarget(step)
    if (!el) {
      const ni = step + travelDir
      if (ni < 0 || ni >= STEPS.length) useTour.getState().stop()
      else useTour.setState({ step: ni })
      return
    }
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    const update = () => setRect(padRect(el.getBoundingClientRect()))
    update()
    // Re-measure on the next frame in case scrollIntoView moved the anchor.
    const raf = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', update)
    }
  }, [active, step])

  // Place the card below the rect, flipping above / beside when it would clip.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!rect || !card) return
    const cw = card.offsetWidth
    const ch = card.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let top = rect.top + rect.height + CARD_GAP
    let left = rect.left + rect.width / 2 - cw / 2
    if (top + ch > vh - EDGE) {
      top = rect.top - ch - CARD_GAP // flip above
      if (top < EDGE) {
        // Neither below nor above fits — place beside (right, then left).
        left = rect.left + rect.width + CARD_GAP
        top = rect.top
        if (left + cw > vw - EDGE) left = rect.left - cw - CARD_GAP
      }
    }
    setCardPos({ top: clamp(top, EDGE, vh - ch - EDGE), left: clamp(left, EDGE, vw - cw - EDGE) })
  }, [rect, step])

  // Keyboard navigation; capture phase so app-level shortcuts don't fire too.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing: the app stays interactive behind the tour, so
      // arrows/Enter inside an input must keep their normal meaning.
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        useTour.getState().next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        useTour.getState().prev()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        useTour.getState().stop()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])

  if (!active || !rect) return null
  const s = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <div className="tour-overlay">
      <div className="tour-spot" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
      <div
        className="tour-card"
        ref={cardRef}
        style={cardPos ? { top: cardPos.top, left: cardPos.left } : { top: -9999, left: -9999, visibility: 'hidden' }}
      >
        <button className="tour-skip" title={tr('Закрыть')} onClick={() => useTour.getState().stop()}>
          <Icon name="close" size={13} />
        </button>
        <div className="tour-progress">{trf('Шаг {n} из {total}', { n: step + 1, total: STEPS.length })}</div>
        <h4>{tr(s.title)}</h4>
        <p>{s.keyHint ? trf(s.body, { key: kbd(s.keyHint) }) : tr(s.body)}</p>
        <div className="tour-foot">
          {!last && (
            <button className="btn ghost tour-skip-text" onClick={() => useTour.getState().stop()}> {tr('Пропустить')} </button>
          )}
          {step > 0 && (
            <button className="btn ghost" onClick={() => useTour.getState().prev()}> {tr('Назад')} </button>
          )}
          <button className="btn primary" onClick={() => useTour.getState().next()}>
            {last ? tr('Готово') : tr('Далее')}
          </button>
        </div>
      </div>
    </div>
  )
}
