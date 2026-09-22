#!/usr/bin/env node
/**
 * Publish Relay to GitHub Releases from the machine you run it on.
 *
 *   npm run release                    build for this OS and upload to release v<package.json version>
 *   npm run release -- --skip-build    upload what is already in release/
 *   npm run release -- --dry-run       build and list what would be uploaded, touch nothing on GitHub
 *   npm run release -- --draft         create the release as a draft
 *   npm run release -- --linux-tar     also build a portable Linux tar.gz (from Windows/macOS)
 *   npm run release -- --version 1.1.1 --dir ../old/release --skip-build
 *
 * Run it once on Windows, once on macOS and once on Linux: every run adds its
 * installers to the same release (an asset with the same name is replaced).
 * The CI workflow (.github/workflows/release.yml) does the same for all three
 * systems when GitHub Actions is available for the repository.
 *
 * Auth: a token with write access to the repository contents, from GH_TOKEN /
 * GITHUB_TOKEN, or from the GitHub CLI (`gh auth login`). Release notes come
 * from docs/releases/v<version>.md when that file exists.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const REPO = 'CHUKEPC/Relay'
const API = 'https://api.github.com'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const option = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = option('version') ?? pkg.version
const tag = `v${version}`
const outDir = resolve(ROOT, option('dir') ?? 'release')
const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'

function fail(message) {
  console.error(`\n✖ ${message}\n`)
  process.exit(1)
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  if (res.status !== 0) fail(`${cmd} ${args.join(' ')} failed (exit ${res.status})`)
}

/* -------------------------------------------------------------- checks */

if (!option('version')) {
  const constants = readFileSync(join(ROOT, 'src/shared/constants.ts'), 'utf8')
  const appVersion = /APP_VERSION = '([^']+)'/.exec(constants)?.[1]
  if (appVersion !== version) fail(`package.json is ${version} but APP_VERSION in src/shared/constants.ts is ${appVersion}`)
}

try {
  const remote = execFileSync('git', ['ls-remote', '--tags', 'origin', tag], { cwd: ROOT, encoding: 'utf8' })
  const hint = `tag ${tag} is not on GitHub yet. Push it first:\n    git tag ${tag}\n    git push origin ${tag}`
  if (!remote.trim()) {
    if (flag('dry-run')) console.warn(`\n! ${hint}`)
    else fail(hint)
  }
} catch (err) {
  if (!flag('dry-run')) fail(`cannot reach the git remote: ${err.message}`)
}

/* -------------------------------------------------------------- build */

/**
 * A tarball built on Windows carries no execute bits (NTFS has none), so the
 * Linux binary would not start without `chmod +x`. Patch the mode field of the
 * executables in every tar header and fix the header checksum.
 */
function fixLinuxTarModes(file) {
  const tar = gunzipSync(readFileSync(file))
  const str = (buf) => buf.toString('utf8').replace(/\0.*$/s, '')
  let patched = 0
  for (let off = 0; off + 512 <= tar.length; ) {
    const header = tar.subarray(off, off + 512)
    if (header.every((b) => b === 0)) break
    const name = [str(header.subarray(345, 500)), str(header.subarray(0, 100))].filter(Boolean).join('/')
    const size = parseInt(str(header.subarray(124, 136)).trim() || '0', 8)
    const base = name.split('/').pop()
    const mode = base === 'chrome-sandbox' ? 0o4755 : /^(relay-api-client|chrome_crashpad_handler)$|\.so(\.\d+)*$/.test(base) ? 0o755 : null
    if (mode !== null && header[156] === 0x30 /* '0' regular file */) {
      header.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8, 'ascii')
      header.fill(0x20, 148, 156)
      const sum = header.reduce((a, b) => a + b, 0)
      header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
      patched++
    }
    off += 512 + Math.ceil(size / 512) * 512
  }
  writeFileSync(file, gzipSync(tar, { level: 9 }))
  console.log(`  ${basename(file)}: execute bits restored on ${patched} file(s)`)
}

/**
 * electron-builder empties release/win-unpacked first and fails with a Go stack
 * trace when a Relay started from there is still running. Probe with a rename,
 * which Windows refuses while any file inside is in use.
 */
function ensureUnpackedFree() {
  const dir = join(outDir, 'win-unpacked')
  if (platform !== 'win' || !existsSync(dir)) return
  const probe = `${dir}.lock-check`
  try {
    renameSync(dir, probe)
    renameSync(probe, dir)
  } catch {
    fail(`${dir} is in use — close Relay started from that folder (and any Explorer window inside it), then run again.`)
  }
}

if (!flag('skip-build')) {
  ensureUnpackedFree()
  run('npm', ['run', 'build'])
  const archArgs = platform === 'mac' ? ['--x64', '--arm64'] : ['--x64']
  run('npx', ['--no-install', 'electron-builder', `--${platform}`, ...archArgs, '--publish', 'never'])
  // From Windows, Linux can still get a portable tar.gz (AppImage/deb need Linux or a CI runner).
  if (flag('linux-tar') && platform !== 'linux') {
    run('npx', ['--no-install', 'electron-builder', '--linux', 'tar.gz', '--x64', '--publish', 'never'])
  }
}
if (flag('linux-tar')) {
  const tarball = join(outDir, `${pkg.name}-${version}.tar.gz`)
  if (existsSync(tarball)) fixLinuxTarModes(tarball)
}

/* -------------------------------------------------------------- artifacts */

const PATTERNS = {
  win: [/-Setup\.exe$/, /-Setup\.exe\.blockmap$/, /^latest\.yml$/],
  mac: [/\.dmg$/, /\.dmg\.blockmap$/, /-mac\.zip$/, /-mac\.zip\.blockmap$/, /^latest-mac\.yml$/],
  linux: [/\.AppImage$/, /\.deb$/, /^latest-linux\.yml$/]
}
if (!existsSync(outDir)) fail(`${outDir} does not exist — build first or pass --dir`)
const files = readdirSync(outDir)
  .filter((name) => [...PATTERNS[platform], ...(flag('linux-tar') ? [/\.tar\.gz$/] : [])].some((re) => re.test(name)))
  // Only this version's installers; the latest*.yml files are rewritten on every build.
  .filter((name) => name.startsWith('latest') || name.includes(version))
  .map((name) => join(outDir, name))
if (!files.length) fail(`no ${platform} artifacts for ${version} in ${outDir}`)

console.log(`\nArtifacts for ${tag} (${platform}):`)
for (const f of files) console.log(`  ${basename(f)}  ${(statSync(f).size / 1024 / 1024).toFixed(1)} MB`)
if (flag('dry-run')) {
  console.log('\n--dry-run: nothing uploaded.')
  process.exit(0)
}

/* -------------------------------------------------------------- GitHub */

function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const auth = token()
if (!auth)
  fail(
    'no GitHub token. Either run `gh auth login`, or create a token at https://github.com/settings/tokens ' +
      '(fine-grained: repository CHUKEPC/Relay, "Contents: Read and write") and set GH_TOKEN before running.'
  )

async function gh(method, url, body, headers = {}) {
  const res = await fetch(url.startsWith('http') ? url : API + url, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'relay-release-script',
      ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined
  })
  if (res.status === 404 && method === 'GET') return null
  if (!res.ok) fail(`GitHub ${method} ${url} → ${res.status}: ${(await res.text()).slice(0, 400)}`)
  return res.status === 204 ? null : res.json()
}

const notesFile = join(ROOT, 'docs', 'releases', `${tag}.md`)
const notes = existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : undefined

let release = await gh('GET', `/repos/${REPO}/releases/tags/${tag}`)
if (!release) {
  console.log(`\nCreating release ${tag}…`)
  release = await gh('POST', `/repos/${REPO}/releases`, {
    tag_name: tag,
    name: `Relay ${tag}`,
    body: notes,
    draft: flag('draft'),
    prerelease: false,
    generate_release_notes: !notes
  })
} else if (notes && !release.body) {
  release = await gh('PATCH', `/repos/${REPO}/releases/${release.id}`, { body: notes })
}

for (const file of files) {
  const name = basename(file)
  const existing = (release.assets ?? []).find((a) => a.name === name)
  if (existing) {
    console.log(`Replacing ${name}…`)
    await gh('DELETE', `/repos/${REPO}/releases/assets/${existing.id}`)
  } else console.log(`Uploading ${name}…`)
  const data = new Uint8Array(readFileSync(file))
  const uploadUrl = release.upload_url.replace(/\{.*\}$/, '') + `?name=${encodeURIComponent(name)}`
  await gh('POST', uploadUrl, data, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.byteLength) })
}

console.log(`\n✔ ${tag}: ${files.length} file(s) published → ${release.html_url}\n`)
