/**
 * UI translation.
 *
 * The source language is Russian and the Russian string *is* the key: `t('Отправить')`
 * looks up the active catalog and falls back to its own argument. That keeps the
 * code readable, makes a missing translation degrade to correct Russian rather
 * than to a raw key, and means adding a language is a data-only change.
 *
 * Russian and English ship with the app; other catalogs come from the
 * «Дополнительные языки» pack in the `plugins/` folder.
 */
import { create } from 'zustand'
import en from '@renderer/locales/en.json'
import { CORE_LOCALES } from '@shared/features'

export type Dict = Record<string, string>

/** Display names, in the language itself — that is how language pickers read. */
export const LANGUAGE_NAMES: Record<string, string> = {
  ru: 'Русский',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  zh: '中文'
}

const CORE_DICTS: Record<string, Dict> = {
  ru: {},
  en: en as Dict
}

/**
 * Active catalog, read synchronously by `t()`. A module-level value (rather
 * than store state) keeps `t()` callable from anywhere — including module
 * constants and non-React code — at zero subscription cost.
 */
let current: Dict = {}
/** English is the fallback for plugin languages: closer than Russian for their users. */
let fallback: Dict = {}

interface I18nState {
  lang: string
  /** bumped on every catalog swap so the app can remount and re-read `t()` */
  epoch: number
}

export const useI18n = create<I18nState>(() => ({ lang: 'ru', epoch: 0 }))

/**
 * Translate; unknown strings come back unchanged (correct Russian).
 *
 * Named `tr` rather than `t` because `t` is already the conventional local name
 * for a tab or a table row here and would be shadowed inside callbacks.
 */
export function tr(source: string): string {
  return current[source] ?? fallback[source] ?? source
}

/** Translate with `{name}` placeholders. */
export function trf(source: string, vars: Record<string, string | number>): string {
  return tr(source).replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole))
}

/**
 * Plural form, picked by the ACTIVE language's rules and then translated.
 *
 * The three arguments are the Russian one/few/many forms, so a call still reads
 * as Russian at the call site. Languages with two forms (English, German,
 * Spanish) never select `few`, so their catalogs only have to translate `one`
 * and `many` — and they get "21 domains" right, which hardcoded Russian rules
 * would not.
 */
export function trp(n: number, one: string, few: string, many: string): string {
  let category: Intl.LDMLPluralRule = 'other'
  try {
    category = new Intl.PluralRules(useI18n.getState().lang).select(n)
  } catch {
    // Unknown language tag — fall back to the source language's own rules.
  }
  return tr(category === 'one' ? one : category === 'few' ? few : many)
}

/** Is this language part of the base app? */
export function isCoreLanguage(code: string): boolean {
  return (CORE_LOCALES as readonly string[]).includes(code)
}

/**
 * How much of the UI a catalog covers, as a share of the English catalog. The
 * language picker shows it so a partial plugin language is never a surprise.
 */
export function coverage(dict: Dict): number {
  const total = Object.keys(en as Dict).length
  if (!total) return 1
  let hit = 0
  for (const key of Object.keys(en as Dict)) if (dict[key]) hit++
  return hit / total
}

/**
 * Swap the active catalog. Core languages are bundled; anything else is read
 * from an enabled language pack (and silently falls back to Russian when the
 * pack was removed).
 */
export async function applyLanguage(code: string): Promise<void> {
  // Re-applying the active language must not bump the epoch: the app remounts on
  // every bump, and a remount re-runs bootstrap — which applies the language
  // again. Without this guard that is an endless loop.
  if (code === useI18n.getState().lang) return
  let dict: Dict | null = CORE_DICTS[code] ?? null
  if (!dict) {
    try {
      dict = await window.api.featuresLocale(code)
    } catch {
      dict = null
    }
  }
  if (!dict) {
    current = {}
    fallback = {}
    useI18n.setState((s) => ({ lang: 'ru', epoch: s.epoch + 1 }))
    return
  }
  current = dict
  fallback = code === 'ru' || code === 'en' ? {} : (en as Dict)
  useI18n.setState((s) => ({ lang: code, epoch: s.epoch + 1 }))
  document.documentElement.lang = code
}
