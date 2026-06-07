/**
 * The single variable resolver used everywhere. `{{name}}` syntax with
 * Postman precedence (local → collection → environment → global) plus dynamic
 * `{{$...}}` built-ins. Unresolved tokens are left literal and reported so the
 * UI can flag them.
 */
import type { ResolvedToken, VariableDef, VariableScope } from './types'

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g

export function flattenVariables(defs: VariableDef[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!defs) return out
  for (const d of defs) {
    if (d.enabled && d.key) out[d.key] = d.value
  }
  return out
}

let guidCounter = 0

function randomInt(min = 0, max = 1000): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)]
}

function uuidv4(): string {
  // RFC4122-ish v4; good enough for {{$guid}}/{{$randomUUID}}.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ---------------------------------------------------------------------------
// Small built-in word/name banks. Pseudo-random JS only — no native deps.
// ---------------------------------------------------------------------------
const FIRST_NAMES = [
  'Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Ruth', 'Tim',
  'Anita', 'Donald', 'Edsger', 'Frances', 'Guido', 'Hedy', 'Ivan', 'Joan', 'Karl', 'Lena',
  'Mike', 'Nina', 'Oscar', 'Paula', 'Quincy', 'Rosa', 'Sam', 'Tara', 'Umar', 'Vera'
]
const LAST_NAMES = [
  'Lovelace', 'Torvalds', 'Hopper', 'Turing', 'Hamilton', 'Ritchie', 'Liskov', 'Thompson',
  'Knuth', 'Dijkstra', 'Allen', 'Berners-Lee', 'Engelbart', 'Backus', 'Wozniak', 'Lamarr',
  'Sutherland', 'Cerf', 'Kay', 'Perlman', 'Rivest', 'Shamir', 'Adleman', 'Diffie', 'Hellman'
]
const NAME_PREFIXES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof']
const NAME_SUFFIXES = ['Jr', 'Sr', 'II', 'III', 'IV', 'V', 'MD', 'PhD', 'DDS']
const JOB_TITLES = [
  'Software Engineer', 'Product Manager', 'Data Scientist', 'DevOps Specialist', 'UX Designer',
  'Solutions Architect', 'QA Analyst', 'Security Consultant', 'Site Reliability Engineer',
  'Engineering Manager', 'Technical Writer', 'Database Administrator', 'Cloud Architect',
  'Frontend Developer', 'Backend Developer', 'Mobile Developer', 'Systems Analyst'
]
const WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do',
  'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim',
  'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip',
  'commodo', 'consequat', 'duis', 'aute', 'irure', 'reprehenderit', 'voluptate', 'velit', 'esse'
]
const CITIES = [
  'Springfield', 'Riverside', 'Fairview', 'Madison', 'Georgetown', 'Salem', 'Franklin',
  'Greenville', 'Bristol', 'Clinton', 'Kingston', 'Ashland', 'Burlington', 'Manchester',
  'Oakland', 'Dover', 'Newport', 'Auburn', 'Lebanon', 'Hudson'
]
const STREET_NAMES = [
  'Maple', 'Oak', 'Cedar', 'Pine', 'Elm', 'Washington', 'Lake', 'Hill', 'Park', 'Sunset',
  'Lincoln', 'Jackson', 'River', 'Spring', 'Highland', 'Forest', 'Meadow', 'Church', 'Market'
]
const STREET_SUFFIXES = ['Street', 'Avenue', 'Lane', 'Road', 'Boulevard', 'Drive', 'Court', 'Way', 'Place']
const COUNTRIES = [
  'United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Japan', 'Australia',
  'Brazil', 'India', 'Sweden', 'Netherlands', 'Italy', 'Spain', 'Norway', 'Mexico', 'Poland'
]
const COUNTRY_CODES = ['US', 'CA', 'GB', 'DE', 'FR', 'JP', 'AU', 'BR', 'IN', 'SE', 'NL', 'IT', 'ES', 'NO', 'MX', 'PL']
const DOMAIN_WORDS = [
  'acme', 'globex', 'initech', 'umbrella', 'soylent', 'hooli', 'pied-piper', 'stark', 'wayne',
  'wonka', 'cyberdyne', 'tyrell', 'aperture', 'oscorp', 'massive', 'vandelay', 'nakatomi'
]
const TLDS = ['com', 'net', 'org', 'io', 'co', 'dev', 'app', 'info', 'biz']
const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SEK', 'NZD', 'BRL', 'INR']
const COMPANY_SUFFIXES = ['Inc', 'LLC', 'Group', 'Corp', 'Holdings', 'Industries', 'Partners', 'Labs', 'Systems']
const PRODUCT_ADJ = ['Ergonomic', 'Rustic', 'Sleek', 'Refined', 'Handcrafted', 'Intelligent', 'Gorgeous', 'Fantastic', 'Practical', 'Generic']
const PRODUCT_MATERIAL = ['Steel', 'Wooden', 'Concrete', 'Plastic', 'Cotton', 'Granite', 'Rubber', 'Metal', 'Soft', 'Fresh']
const PRODUCT_NOUN = ['Chair', 'Keyboard', 'Table', 'Shoes', 'Hat', 'Gloves', 'Computer', 'Bike', 'Lamp', 'Mouse', 'Towels', 'Salad']
const COLORS = ['red', 'green', 'blue', 'amber', 'violet', 'teal', 'cyan', 'magenta', 'maroon', 'olive', 'navy', 'lime', 'fuchsia', 'silver']
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
]

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function hex(len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += randomInt(0, 15).toString(16)
  return out
}

function randomWords(count: number): string {
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(pick(WORDS))
  return out.join(' ')
}

function loremSentence(): string {
  const n = randomInt(4, 10)
  const words = randomWords(n).split(' ')
  return capitalize(words.join(' ')) + '.'
}

function loremParagraph(): string {
  const n = randomInt(3, 6)
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(loremSentence())
  return out.join(' ')
}

function randomFirstName(): string {
  return pick(FIRST_NAMES)
}
function randomLastName(): string {
  return pick(LAST_NAMES)
}
function randomDomainWord(): string {
  return pick(DOMAIN_WORDS)
}
function randomDomainName(): string {
  return `${randomDomainWord()}.${pick(TLDS)}`
}
function randomUserName(): string {
  return `${randomFirstName().toLowerCase()}.${randomLastName().toLowerCase()}${randomInt(1, 99)}`
}
function randomIP(): string {
  return `${randomInt(1, 255)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`
}
function randomIPV6(): string {
  const groups: string[] = []
  for (let i = 0; i < 8; i++) groups.push(hex(4))
  return groups.join(':')
}
function randomMAC(): string {
  const parts: string[] = []
  for (let i = 0; i < 6; i++) parts.push(hex(2))
  return parts.join(':')
}

// ISO-like datetime within +/- range (days) relative to now.
function dateOffsetDays(minDays: number, maxDays: number): Date {
  const days = randomInt(minDays, maxDays)
  const ms = days * 86400000 + randomInt(0, 86399999)
  return new Date(Date.now() + ms)
}

type Generator = () => string

const GENERATORS: Record<string, Generator> = {
  // --- Names ---
  $randomfirstname: randomFirstName,
  $randomlastname: randomLastName,
  $randomfullname: () => `${randomFirstName()} ${randomLastName()}`,
  $randomnameprefix: () => pick(NAME_PREFIXES),
  $randomnamesuffix: () => pick(NAME_SUFFIXES),
  $randomjobtitle: () => pick(JOB_TITLES),

  // --- Internet ---
  $randomusername: randomUserName,
  $randompassword: () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
    let out = ''
    const len = randomInt(10, 16)
    for (let i = 0; i < len; i++) out += chars[randomInt(0, chars.length - 1)]
    return out
  },
  $randomemail: () => `${randomUserName()}@${randomDomainName()}`,
  $randomurl: () => `https://${randomDomainName()}`,
  $randomdomainname: randomDomainName,
  $randomdomainword: randomDomainWord,
  $randomip: randomIP,
  $randomipv6: randomIPV6,
  $randommacaddress: randomMAC,
  $randomuseragent: () => pick(USER_AGENTS),
  $randomhexcolor: () => `#${hex(6)}`,
  $randomcolor: () => pick(COLORS),

  // --- Address ---
  $randomcity: () => pick(CITIES),
  $randomstreetname: () => `${pick(STREET_NAMES)} ${pick(STREET_SUFFIXES)}`,
  $randomstreetaddress: () => `${randomInt(1, 9999)} ${pick(STREET_NAMES)} ${pick(STREET_SUFFIXES)}`,
  $randomcountry: () => pick(COUNTRIES),
  $randomcountrycode: () => pick(COUNTRY_CODES),
  $randomlatitude: () => (Math.random() * 180 - 90).toFixed(6),
  $randomlongitude: () => (Math.random() * 360 - 180).toFixed(6),
  $randomphonenumber: () => `${randomInt(200, 999)}-${randomInt(200, 999)}-${String(randomInt(0, 9999)).padStart(4, '0')}`,
  $randomzipcode: () => String(randomInt(10000, 99999)),

  // --- Lorem ---
  $randomword: () => pick(WORDS),
  $randomwords: () => randomWords(randomInt(2, 5)),
  $randomloremsentence: loremSentence,
  $randomloremparagraph: loremParagraph,
  $randomloremtext: loremParagraph,
  $randomloremslug: () => {
    const n = randomInt(2, 4)
    const parts: string[] = []
    for (let i = 0; i < n; i++) parts.push(pick(WORDS))
    return parts.join('-')
  },

  // --- Finance / commerce ---
  $randombankaccount: () => String(randomInt(10000000, 99999999)),
  $randomcreditcardmask: () => `****-****-****-${String(randomInt(0, 9999)).padStart(4, '0')}`,
  $randomcurrencycode: () => pick(CURRENCY_CODES),
  $randomprice: () => (randomInt(100, 99999) / 100).toFixed(2),
  $randomcompanyname: () => `${randomLastName()} ${pick(COMPANY_SUFFIXES)}`,
  $randomproduct: () => `${pick(PRODUCT_ADJ)} ${pick(PRODUCT_MATERIAL)} ${pick(PRODUCT_NOUN)}`,

  // --- Datetime / misc ---
  $randomint: () => String(randomInt(0, 1000)),
  $randomdatetime: () => dateOffsetDays(-365, 365).toISOString(),
  $randomdaterecent: () => dateOffsetDays(-7, 0).toISOString(),
  $randomdatepast: () => dateOffsetDays(-3650, -1).toISOString(),
  $randomdatefuture: () => dateOffsetDays(1, 3650).toISOString(),
  $randomboolean: () => (Math.random() < 0.5 ? 'true' : 'false'),
  $guid: uuidv4,
  $randomuuid: uuidv4,
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isotimestamp: () => new Date().toISOString(),
  $counter: () => String(guidCounter++)
}

/** Canonical (camelCase) names of every supported `{{$...}}` dynamic variable,
 *  for UI autocomplete / discovery. Kept in sync with GENERATORS. */
export const DYNAMIC_VAR_NAMES: string[] = [
  // Names
  '$randomFirstName', '$randomLastName', '$randomFullName', '$randomNamePrefix',
  '$randomNameSuffix', '$randomJobTitle',
  // Internet
  '$randomUserName', '$randomPassword', '$randomEmail', '$randomUrl', '$randomDomainName',
  '$randomDomainWord', '$randomIP', '$randomIPV6', '$randomMACAddress', '$randomUserAgent',
  '$randomHexColor', '$randomColor',
  // Address
  '$randomCity', '$randomStreetName', '$randomStreetAddress', '$randomCountry',
  '$randomCountryCode', '$randomLatitude', '$randomLongitude', '$randomPhoneNumber',
  '$randomZipCode',
  // Lorem
  '$randomWord', '$randomWords', '$randomLoremSentence', '$randomLoremParagraph',
  '$randomLoremText', '$randomLoremSlug',
  // Finance / commerce
  '$randomBankAccount', '$randomCreditCardMask', '$randomCurrencyCode', '$randomPrice',
  '$randomCompanyName', '$randomProduct',
  // Datetime / misc
  '$randomInt', '$randomDatetime', '$randomDateRecent', '$randomDatePast', '$randomDateFuture',
  '$randomBoolean', '$guid', '$randomUUID', '$timestamp', '$isoTimestamp', '$counter'
]

/** Resolve a single dynamic `$` variable, or return null if it is not one we know.
 *  Matching is case-insensitive (e.g. `$randomFirstName` == `$randomfirstname`). */
export function resolveDynamic(name: string): string | null {
  if (!name.startsWith('$')) return null
  const fn = GENERATORS[name.toLowerCase()]
  return fn ? fn() : null
}

/** Own-property check — NOT `in`, which would match inherited Object.prototype
 *  members (constructor, toString, __proto__, ...) and return a function value
 *  that later code would try to `.replace()` on, throwing. */
function hasOwn(obj: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function lookup(name: string, scope: VariableScope): ResolvedToken {
  const dyn = resolveDynamic(name)
  if (dyn !== null) return { name, value: dyn, source: 'dynamic' }
  if (scope.local && hasOwn(scope.local, name)) return { name, value: scope.local[name], source: 'local' }
  if (scope.collection && hasOwn(scope.collection, name))
    return { name, value: scope.collection[name], source: 'collection' }
  if (scope.environment && hasOwn(scope.environment, name))
    return { name, value: scope.environment[name], source: 'environment' }
  if (scope.global && hasOwn(scope.global, name)) return { name, value: scope.global[name], source: 'global' }
  return { name, value: null, source: 'unresolved' }
}

export interface ResolveStringResult {
  value: string
  tokens: ResolvedToken[]
  unresolved: string[]
}

/**
 * Resolve all `{{var}}` tokens in `input`. Supports nested resolution (a variable
 * whose value itself contains `{{...}}`) up to `maxDepth` levels, while detecting
 * reference cycles (a self- or mutually-referential variable is left literal and
 * reported as unresolved instead of being expanded into garbage).
 */
export function resolveString(input: string, scope: VariableScope, maxDepth = 10): ResolveStringResult {
  const tokens: ResolvedToken[] = []
  const unresolved = new Set<string>()

  // `seen` is the set of variable names currently being expanded on this branch,
  // so a cycle (a -> a, a -> b -> a) is caught. A fresh regex per call avoids the
  // shared-lastIndex reentrancy hazard of recursing on one global regex.
  const expand = (str: string, seen: Set<string>, depth: number, collect: boolean): string => {
    if (depth > maxDepth) {
      const re = /\{\{\s*([^}]+?)\s*\}\}/g
      let m: RegExpExecArray | null
      while ((m = re.exec(str)) !== null) unresolved.add(m[1].trim())
      return str
    }
    const re = /\{\{\s*([^}]+?)\s*\}\}/g
    return str.replace(re, (whole, rawName: string) => {
      const name = rawName.trim()
      if (seen.has(name)) {
        unresolved.add(name) // cycle — leave literal
        if (collect) tokens.push({ name, value: null, source: 'unresolved' })
        return whole
      }
      const t = lookup(name, scope)
      if (t.value === null) {
        unresolved.add(name)
        if (collect) tokens.push(t)
        return whole // leave literal
      }
      const resolved = expand(t.value, new Set([...seen, name]), depth + 1, false)
      if (collect) tokens.push({ name, value: resolved, source: t.source })
      return resolved
    })
  }

  const value = expand(input ?? '', new Set(), 0, true)
  return { value, tokens, unresolved: [...unresolved] }
}

/** Convenience: resolve and return only the string. */
export function interpolate(input: string, scope: VariableScope): string {
  return resolveString(input, scope).value
}

/** Extract the variable names referenced by a string (for highlighting). */
export function extractTokens(input: string): string[] {
  const names: string[] = []
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(input)) !== null) names.push(m[1].trim())
  return names
}
