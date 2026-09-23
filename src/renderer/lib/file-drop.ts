/**
 * Files dragged from Explorer / Finder onto the window.
 *
 * Every file is routed by what it is, not by where it was dropped:
 *  - `.env`, `.csv`, `.tsv` and a Postman-less variable list → a new environment;
 *  - a Relay theme (`variants`) → «Мои темы»;
 *  - a Relay backup → a pointer to Settings → Data (a restore replaces data, so
 *    it stays a deliberate step there);
 *  - anything else → the same auto-detecting import as the «Импорт» dialog
 *    (Postman collection/environment/globals, OpenAPI, Swagger, HAR, Insomnia,
 *    cURL).
 * One toast sums up the whole drop.
 */
import { makeId } from '@shared/id'
import { parseVariables } from '@shared/var-import'
import { useEnvironments } from '@renderer/store/environments'
import { useUi } from '@renderer/store/ui'
import { useUserThemes } from '@renderer/store/user-themes'
import { applyImportResults, cleanImportError } from './import-apply'
import { tr, trf } from './i18n'

/** Anything larger is not an API description a person would drop by hand. */
const MAX_BYTES = 50 * 1024 * 1024

const VARIABLE_FILE = /(^\.env(\..+)?$)|\.(env|csv|tsv)$/i
const BACKUP_FILE = /\.(zip|sqlite|db)$|\.relay\.json$/i

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || name
}

function isThemeJson(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  if (o.variants && typeof o.variants === 'object') return true
  const list = Array.isArray(raw) ? raw : Array.isArray(o.themes) ? o.themes : null
  return !!list && list.length > 0 && list.every((t) => t && typeof t === 'object' && 'variants' in (t as object))
}

/** What one file turned into, for the summary toast. */
type Outcome = { ok: string } | { error: string }

async function importOne(file: File): Promise<Outcome> {
  if (file.size > MAX_BYTES) return { error: trf('{file}: файл слишком большой', { file: file.name }) }
  if (BACKUP_FILE.test(file.name)) {
    return { error: trf('{file}: резервная копия восстанавливается в «Настройки → Данные»', { file: file.name }) }
  }
  const text = await file.text()

  if (VARIABLE_FILE.test(file.name)) {
    const parsed = parseVariables(text)
    if (!parsed.variables.length) return { error: trf('{file}: переменные не найдены', { file: file.name }) }
    useEnvironments.getState().addEnvironment({ id: makeId('env'), name: parsed.name || baseName(file.name), variables: parsed.variables })
    return { ok: trf('окружение «{name}»', { name: parsed.name || baseName(file.name) }) }
  }

  let json: unknown = undefined
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON — YAML (OpenAPI) or a cURL command; the importer decides
  }
  if (json && typeof json === 'object' && (json as { kind?: unknown }).kind === 'workspace-backup') {
    return { error: trf('{file}: резервная копия восстанавливается в «Настройки → Данные»', { file: file.name }) }
  }
  if (isThemeJson(json)) {
    const res = useUserThemes.getState().addFromText(text, baseName(file.name))
    if (res.error) return { error: trf('{file}: тема не прочитана', { file: file.name }) }
    return { ok: trf('тем: {n}', { n: res.added + res.replaced }) }
  }

  try {
    const results = await window.api.importData('auto', text)
    if (!results.length) return { error: trf('{file}: формат не распознан', { file: file.name }) }
    const applied = applyImportResults(results)
    return { ok: applied.summary || file.name }
  } catch (err) {
    return { error: `${file.name}: ${cleanImportError(err instanceof Error ? err.message : String(err))}` }
  }
}

export async function importDroppedFiles(files: File[]): Promise<void> {
  if (!files.length) return
  const done: string[] = []
  const failed: string[] = []
  for (const file of files) {
    const outcome = await importOne(file)
    if ('ok' in outcome) done.push(outcome.ok)
    else failed.push(outcome.error)
  }
  const toast = useUi.getState().showToast
  if (done.length && !failed.length) toast(trf('Импортировано: {what}', { what: done.join(', ') }))
  else if (done.length) toast(trf('Импортировано: {what}. Не удалось: {failed}', { what: done.join(', '), failed: failed.join('; ') }), 'error')
  else toast(failed.join('; ') || tr('Нечего импортировать'), 'error')
}
