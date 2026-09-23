/**
 * Translation for the handful of strings the main process shows itself.
 *
 * Native dialogs (file pickers, message boxes) and window titles are drawn by
 * the OS, not by React, so they cannot go through the renderer catalog. The
 * convention is the same as in `src/renderer/lib/i18n.ts`: the Russian string is
 * the key, and a missing entry degrades to correct Russian.
 *
 * Only English is bundled here. A language that comes from the «Дополнительные
 * языки» pack falls back to English for these few strings — the alternative
 * (loading pack catalogs into the main process) buys very little for three
 * dialog titles.
 */
const EN: Record<string, string> = {
  'Выберите плагин': 'Choose a plugin',
  'Плагин Relay': 'Relay plugin',
  'Все файлы': 'All files',
  'Установить плагин из .zip': 'Install a plugin from a .zip',
  Запрос: 'Request',
  'Плагин {name}: {message}': 'Plugin {name}: {message}',
  'Системный прокси не передаётся — задайте его переменными окружения терминала.':
    'The system proxy is not passed on — set it with the terminal environment variables.',
  'Клиентские сертификаты не передаются.': 'Client certificates are not passed on.',
  'Не найден эмулятор терминала (gnome-terminal, konsole, xterm…).': 'No terminal emulator found (gnome-terminal, konsole, xterm…).',
  'Готово — вернитесь в Relay. Вкладку можно закрыть.': 'Done — go back to Relay. You can close this tab.',
  'Вход не завершён: {error}': 'Sign-in was not completed: {error}'
}

let lang = 'ru'

/** Called at boot and whenever the renderer saves a new language. */
export function setMainLanguage(code: unknown): void {
  if (typeof code === 'string' && code) lang = code
}

export function mt(source: string): string {
  return lang === 'ru' ? source : (EN[source] ?? source)
}

/** `mt` with `{name}` placeholders, mirroring the renderer's `trf`. */
export function mtf(source: string, vars: Record<string, string | number>): string {
  return mt(source).replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m))
}

/** The UI language the renderer last reported. */
export function mainLanguage(): string {
  return lang
}
