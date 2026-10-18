#!/usr/bin/env node
/**
 * Relay getting-started helper — one entry point behind the numbered scripts
 * in getting-started/windows, getting-started/macos and getting-started/linux.
 *
 *   node getting-started/scripts/helper.mjs install   download the components (npm ci)
 *   node getting-started/scripts/helper.mjs start     build if needed and open Relay
 *   node getting-started/scripts/helper.mjs demo      run the demo service for the examples
 *   node getting-started/scripts/helper.mjs test      run the automated tests
 *   node getting-started/scripts/helper.mjs package   build an installer for this computer
 *   node getting-started/scripts/helper.mjs doctor    print what is installed (for troubleshooting)
 *
 * Messages follow the system language (Russian or English); RELAY_LANG=en|ru
 * overrides it. Only Node.js itself is required — everything else is called
 * from the project's own node_modules.
 */
import { spawn, spawnSync } from 'node:child_process'
import * as fsModule from 'node:fs'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT = resolve(HERE, '..')
const ROOT = resolve(KIT, '..')
const DEMO = join(KIT, 'demo')
const MIN_NODE = 20
const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'
const DEMO_PORTS = [8470, 8471]
const ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'

/* ---------------- output ---------------- */

/**
 * Language of the messages: RELAY_LANG, else the system's. On Windows the
 * display language is asked from the system — Node.js reports the regional
 * format there, which often differs (Russian Windows with English formats).
 */
function systemLanguage() {
  if (process.env.RELAY_LANG) return process.env.RELAY_LANG
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG
  if (env && env !== 'C' && env !== 'POSIX') return env
  if (IS_WIN) {
    try {
      const out = spawnSync('powershell', ['-NoProfile', '-Command', '[System.Globalization.CultureInfo]::CurrentUICulture.Name'], { encoding: 'utf8', timeout: 4000, windowsHide: true })
      if (out.stdout?.trim()) return out.stdout.trim()
    } catch {
      // fall through to the regional format
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().locale || ''
}
const RU = systemLanguage().toLowerCase().startsWith('ru')
const t = (ru, en) => (RU ? ru : en)

const paint = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
const green = paint('32')
const yellow = paint('33')
const red = paint('31')
const bold = paint('1')
const dim = paint('2')

const say = (s = '') => console.log(s)
const title = (s) => say(`\n${bold('━━ ' + s + ' ━━')}\n`)
const step = (s) => say(`${bold('→')} ${s}`)
const ok = (s) => say(`${green('✔')} ${s}`)
const warn = (s) => say(`${yellow('!')} ${s}`)
const fail = (s) => say(`${red('✖')} ${s}`)

/* ---------------- helpers ---------------- */

/** Run a command with the output shown; resolves to its exit code. */
function run(cmd, args, opts = {}) {
  return new Promise((done) => {
    // npm is a .cmd file on Windows and needs a shell; the arguments here are
    // fixed words, so they go as one command line (Node warns about an array).
    const viaShell = IS_WIN && cmd === 'npm'
    const child = viaShell
      ? spawn([cmd, ...args].join(' '), { cwd: ROOT, stdio: 'inherit', shell: true, ...opts })
      : spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts })
    child.on('error', (err) => {
      fail(String(err.message))
      done(1)
    })
    child.on('exit', (code) => done(code ?? 1))
  })
}

/** Run one of the project's own tools with the current Node.js. */
const runTool = (script, args, opts) => run(process.execPath, [join(ROOT, 'node_modules', ...script.split('/')), ...args], opts)

async function ask(question) {
  if (!process.stdin.isTTY) return false
  // Imported here: old Node.js versions lack it, and they must still reach the friendly version check.
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`${question} ${dim(t('[д/н]', '[y/n]'))} `)).trim().toLowerCase()
  rl.close()
  return ['y', 'yes', 'д', 'да', 'l'].includes(answer)
}

function openFolder(path) {
  const cmd = IS_WIN ? 'explorer' : IS_MAC ? 'open' : 'xdg-open'
  try {
    spawn(cmd, [path], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
  } catch {
    // no file manager — the path is printed anyway
  }
}

const pkg = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const installed = () => existsSync(join(ROOT, 'node_modules', 'electron', 'package.json'))

function checkNode() {
  const major = Number(process.versions.node.split('.')[0])
  if (major >= MIN_NODE) return
  fail(t(`Установлен Node.js ${process.versions.node}, а нужен ${MIN_NODE} или новее.`, `Node.js ${process.versions.node} is installed, but ${MIN_NODE} or newer is needed.`))
  say(t('Скачайте версию LTS с https://nodejs.org, установите её и запустите скрипт ещё раз.', 'Download the LTS version from https://nodejs.org, install it and run this script again.'))
  process.exit(1)
}

function checkProject() {
  if (existsSync(join(ROOT, 'package.json')) && existsSync(join(ROOT, 'src'))) return
  fail(t('Не найдена папка проекта Relay.', 'The Relay project folder was not found.'))
  say(t('Запускайте скрипты из папки getting-started внутри распакованного проекта.', 'Run the scripts from the getting-started folder inside the unpacked project.'))
  process.exit(1)
}

/** Newest modification time of the sources that make up the build. */
function newestSource() {
  let newest = statSync(join(ROOT, 'package.json')).mtimeMs
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else newest = Math.max(newest, statSync(p).mtimeMs)
    }
  }
  walk(join(ROOT, 'src'))
  return newest
}

function buildIsFresh() {
  const main = join(ROOT, 'out', 'main', 'index.js')
  const page = join(ROOT, 'out', 'renderer', 'index.html')
  if (!existsSync(main) || !existsSync(page)) return false
  return Math.min(statSync(main).mtimeMs, statSync(page).mtimeMs) >= newestSource()
}

async function ensureInstalled() {
  if (installed()) return
  warn(t('Компоненты ещё не скачаны — сначала выполню установку.', 'The components are not downloaded yet — installing them first.'))
  if (!(await install())) process.exit(1)
}

async function build() {
  step(t('Собираю Relay из исходного кода (1–2 минуты)…', 'Building Relay from the source code (1–2 minutes)…'))
  const code = await runTool('electron-vite/bin/electron-vite.js', ['build'])
  if (code !== 0) {
    fail(t('Сборка не удалась — текст ошибки выше.', 'The build failed — the error is shown above.'))
    say(t('Попробуйте ещё раз запустить 1-install, затем этот скрипт.', 'Try running 1-install again, then this script.'))
    return false
  }
  ok(t('Сборка готова.', 'Build ready.'))
  return true
}

async function demoRunning(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) })
    return res.ok
  } catch {
    return false
  }
}

/* ---------------- commands ---------------- */

async function install() {
  title(t('Установка компонентов Relay', 'Installing the Relay components'))
  checkNode()
  checkProject()
  ok(t(`Node.js ${process.versions.node} — подходит.`, `Node.js ${process.versions.node} — OK.`))
  step(t('Скачиваю компоненты из интернета: около 750 МБ, обычно 2–10 минут.', 'Downloading the components: about 750 MB, usually 2–10 minutes.'))
  say(dim(t('Предупреждения (WARN) в процессе — это нормально, ждите сообщения «Готово».', 'Warnings (WARN) along the way are normal — wait for the «Done» message.')))
  say()
  let code = await run('npm', ['ci', '--no-audit', '--no-fund'])
  if (code !== 0) {
    say()
    fail(t('Скачать компоненты не удалось.', 'Downloading the components failed.'))
    say(t('Частые причины: нет интернета, мешает антивирус или прокси, сервер GitHub с Electron недоступен.', 'Common causes: no internet, an antivirus or a proxy in the way, the GitHub server with Electron is unreachable.'))
    const retry = await ask(
      t(
        `Повторить, скачивая Electron через зеркало ${ELECTRON_MIRROR}?`,
        `Retry, downloading Electron through the mirror ${ELECTRON_MIRROR}?`
      )
    )
    if (retry) code = await run('npm', ['ci', '--no-audit', '--no-fund'], { env: { ...process.env, ELECTRON_MIRROR } })
  }
  if (code !== 0) {
    fail(t('Установка не завершена. Проверьте интернет и запустите 1-install ещё раз.', 'Installation did not finish. Check the internet connection and run 1-install again.'))
    return false
  }
  say()
  ok(bold(t('Готово! Компоненты установлены.', 'Done! The components are installed.')))
  say(t('Дальше запустите 2-start-relay — откроется Relay.', 'Next, run 2-start-relay — Relay will open.'))
  return true
}

async function start() {
  title(t('Запуск Relay', 'Starting Relay'))
  checkNode()
  checkProject()
  await ensureInstalled()
  if (buildIsFresh()) ok(t('Сборка актуальна — пересобирать не нужно.', 'The build is up to date — no rebuild needed.'))
  else if (!(await build())) process.exit(1)

  const require = createRequire(join(ROOT, 'package.json'))
  const electron = require('electron')
  const log = join(os.tmpdir(), 'relay-start.log')

  const launch = (extra) =>
    new Promise((done) => {
      const fd = openSync(log, 'w')
      const child = spawn(electron, [ROOT, ...extra], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd] })
      closeSync(fd)
      let finished = false
      const timer = setTimeout(() => {
        finished = true
        child.unref()
        done({ alive: true })
      }, 8000)
      child.on('exit', (code) => {
        if (finished) return
        clearTimeout(timer)
        done({ alive: false, code, output: existsSync(log) ? readFileSync(log, 'utf8') : '' })
      })
      child.on('error', (err) => {
        if (finished) return
        clearTimeout(timer)
        done({ alive: false, code: 1, output: String(err.message) })
      })
    })

  step(t('Открываю окно Relay…', 'Opening the Relay window…'))
  // Anything after the command goes to Relay itself, e.g. --user-data-dir=<folder> for a separate profile.
  const passThrough = process.argv.slice(3)
  let result = await launch(passThrough)
  // Some Linux systems forbid the Chromium sandbox Electron starts with
  // (AppArmor, no unprivileged user namespaces): try once more without it.
  if (!result.alive && IS_LINUX && /sandbox|namespace|SUID/i.test(result.output ?? '')) {
    warn(t('Система запретила песочницу Chromium — запускаю с ключом --no-sandbox.', 'The system forbids the Chromium sandbox — starting with --no-sandbox.'))
    result = await launch([...passThrough, '--no-sandbox'])
  }
  if (!result.alive) {
    fail(t(`Relay закрылся сразу после запуска (код ${result.code}).`, `Relay closed right after starting (code ${result.code}).`))
    const tail = (result.output ?? '').trim().split('\n').slice(-15).join('\n')
    if (tail) say(dim(tail))
    say(t(`Полный журнал: ${log}`, `Full log: ${log}`))
    if (IS_LINUX) say(t('В Linux могут не хватать системных библиотек — см. раздел «Если что-то пошло не так» в инструкции.', 'On Linux, system libraries may be missing — see «If something goes wrong» in the guide.'))
    process.exit(1)
  }
  say()
  ok(bold(t('Relay запущен в отдельном окне.', 'Relay is running in its own window.')))
  say(t('Это окно можно закрыть. Чтобы проверить работу на примерах, запустите 3-demo-server.', 'You can close this window. To try the examples, run 3-demo-server.'))
}

async function demo() {
  title(t('Демонстрационный сервис «Интернет-магазин API»', 'Demo service «Online shop API»'))
  checkNode()
  checkProject()
  const files = readdirSync(DEMO).filter((f) => f.endsWith('.json'))
  openFolder(DEMO)
  say(t('Открыта папка с примерами. Перетащите в окно Relay эти файлы (все сразу):', 'The folder with the examples is open. Drag these files into the Relay window (all at once):'))
  for (const f of files) say(`   • ${f}`)
  say(dim(`   ${relative(process.cwd(), DEMO) || DEMO}`))
  say()
  say(t('Затем вверху окна Relay выберите окружение «Локальный стенд».', 'Then pick the «Локальный стенд» (local stand) environment at the top of the Relay window.'))
  say(t('Логин tester, пароль secret; клиент OAuth 2.0: relay-desktop / demo-secret.', 'Login tester, password secret; OAuth 2.0 client: relay-desktop / demo-secret.'))
  say()
  if (await demoRunning(DEMO_PORTS[0])) {
    ok(t('Сервис уже запущен в другом окне — второй запуск не нужен.', 'The service is already running in another window — no need to start it twice.'))
    return
  }
  warn(bold(t('Не закрывайте это окно, пока проверяете примеры: закроете — сервис остановится.', 'Keep this window open while you try the examples: closing it stops the service.')))
  say()
  await import(pathToFileURL(join(DEMO, 'demo-server.mjs')).href)
}

async function test() {
  title(t('Автоматические тесты Relay', 'Relay automated tests'))
  checkNode()
  checkProject()
  await ensureInstalled()
  step(t('Запускаю около тысячи тестов (до минуты)…', 'Running about a thousand tests (up to a minute)…'))
  say()
  const code = await runTool('vitest/vitest.mjs', ['run'])
  say()
  if (code === 0) {
    ok(bold(t('Все тесты пройдены.', 'All tests passed.')))
    say(t('«passed» — пройдено, «skipped» — пропущено: это тесты к внешним сайтам, они выключены, чтобы не зависеть от интернета.', '«passed» = passed, «skipped» = tests against outside websites, switched off so the result does not depend on the internet.'))
  } else {
    fail(t('Есть проваленные тесты (failed) — их названия выше.', 'Some tests failed — their names are above.'))
  }
  return code
}

async function packageApp() {
  title(t('Сборка установщика Relay', 'Building the Relay installer'))
  checkNode()
  checkProject()
  await ensureInstalled()
  if (!(await build())) process.exit(1)
  const target = IS_WIN ? ['--win'] : IS_MAC ? ['--mac'] : ['--linux', 'AppImage']
  step(t('Упаковываю приложение (2–5 минут, в первый раз скачиваются инструменты упаковки)…', 'Packaging the app (2–5 minutes; the first time the packaging tools are downloaded)…'))
  const code = await runTool('electron-builder/cli.js', [...target, '--publish', 'never'])
  if (code !== 0) {
    fail(t('Упаковка не удалась — ошибка выше.', 'Packaging failed — the error is above.'))
    if (IS_WIN) say(t('Если сказано, что папка release\\win-unpacked занята, — закройте Relay и повторите.', 'If it says release\\win-unpacked is in use, close Relay and try again.'))
    process.exit(1)
  }
  const version = pkg().version
  const outDir = join(ROOT, 'release')
  const made = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.includes(version) && /\.(exe|dmg|zip|AppImage|deb)$/.test(f)) : []
  say()
  ok(bold(t('Установщик готов:', 'The installer is ready:')))
  for (const f of made) say(`   • ${join(outDir, f)}`)
  openFolder(outDir)
  say()
  if (IS_WIN) say(t('Запустите Relay-…-Setup.exe. Если Windows покажет «Система Windows защитила ваш компьютер» — нажмите «Подробнее» → «Выполнить в любом случае».', 'Run Relay-…-Setup.exe. If Windows shows «Windows protected your PC», click «More info» → «Run anyway».'))
  if (IS_MAC) say(t('Откройте .dmg и перетащите Relay в «Программы». Первый запуск: правый клик по Relay → «Открыть» → «Открыть».', 'Open the .dmg and drag Relay into Applications. First launch: right-click Relay → Open → Open.'))
  if (IS_LINUX) say(t('Сделайте файл исполняемым и запустите: chmod +x Relay-*.AppImage && ./Relay-*.AppImage', 'Make the file executable and run it: chmod +x Relay-*.AppImage && ./Relay-*.AppImage'))
}

async function doctor() {
  title(t('Проверка окружения', 'Environment check'))
  const version = (cmd, args) =>
    new Promise((done) => {
      const child = IS_WIN ? spawn([cmd, ...args].join(' '), { shell: true }) : spawn(cmd, args)
      let out = ''
      child.stdout?.on('data', (d) => (out += d))
      child.on('error', () => done(null))
      child.on('exit', (code) => done(code === 0 ? out.trim().split('\n')[0] : null))
    })
  const row = (name, value) => say(`   ${name.padEnd(18)} ${value ?? red(t('не найдено', 'not found'))}`)
  row(t('Система', 'System'), `${os.type()} ${os.release()} (${process.arch})`)
  row('Node.js', process.versions.node)
  row('npm', await version('npm', ['-v']))
  row('Git', await version('git', ['--version']))
  row(t('Папка проекта', 'Project folder'), ROOT)
  row(t('Компоненты', 'Components'), installed() ? green(t('скачаны', 'downloaded')) : yellow(t('не скачаны (1-install)', 'not downloaded (1-install)')))
  row(t('Сборка', 'Build'), buildIsFresh() ? green(t('актуальна', 'up to date')) : yellow(t('нужна (2-start-relay)', 'needed (2-start-relay)')))
  try {
    const fs = fsModule.statfsSync(ROOT)
    row(t('Свободно на диске', 'Free disk space'), `${((fs.bavail * fs.bsize) / 1024 ** 3).toFixed(1)} GB`)
  } catch {
    // statfs is not available everywhere
  }
  for (const port of DEMO_PORTS) row(t(`Демо-сервис :${port}`, `Demo service :${port}`), (await demoRunning(port)) ? green(t('работает', 'running')) : dim(t('не запущен', 'not running')))
}

/* ---------------- entry ---------------- */

const commands = { install, start, demo, test, package: packageApp, doctor }
const name = process.argv[2]
if (!commands[name]) {
  say(`Usage: node getting-started/scripts/helper.mjs <${Object.keys(commands).join('|')}>`)
  process.exit(1)
}
const result = await commands[name]()
if (name === 'install' && result === false) process.exitCode = 1
if (name === 'test' && typeof result === 'number') process.exitCode = result
