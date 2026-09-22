import { describe, expect, it } from 'vitest'
import { buildTerminalScript, psNativeArg, psQuote, shQuote, toolsFor, type TerminalRequest } from './terminal-command'

const base = (over: Partial<TerminalRequest> = {}): TerminalRequest => ({
  method: 'POST',
  url: 'https://api.example.com/items?x=1',
  headers: [
    ['Content-Type', 'application/json'],
    ['X-Evil', `$(rm -rf ~); "quoted" 'single' \`tick\``]
  ],
  body: { kind: 'text', text: '{"name":"Иван","q":"a\'b"}' },
  insecure: false,
  followRedirects: true,
  maxRedirects: 10,
  timeoutSec: 30,
  compressed: false,
  notes: [],
  ...over
})

const file = (s: { files: { name: string; content: string }[] }, name: string) => s.files.find((f) => f.name === name)?.content ?? ''

describe('quoting', () => {
  it('POSIX single quotes survive every shell metacharacter', () => {
    expect(shQuote(`a'b`)).toBe(`'a'\\''b'`)
    expect(shQuote('$(x) `y` "z"')).toBe(`'$(x) \`y\` "z"'`)
  })
  it('PowerShell literals double single quotes (incl. typographic ones)', () => {
    expect(psQuote(`it's`)).toBe(`'it''s'`)
    expect(psQuote('a’b')).toBe(`'a’’b'`)
    expect(psQuote('$env:SECRET')).toBe(`'$env:SECRET'`)
  })
  it('native arguments escape quotes for Windows PowerShell 5.1', () => {
    expect(psNativeArg('{"a":1}')).toBe(`'{\\"a\\":1}'`)
    expect(psNativeArg('C:\\dir with space\\')).toBe(`'C:\\dir with space\\\\'`)
  })
})

describe('curl', () => {
  it('puts everything in a curl config, quoted for curl', () => {
    const s = buildTerminalScript('curl', base({ insecure: true, credentials: { scheme: 'digest', username: 'u', password: 'p"w' } }), 'linux', '/tmp/relay-term-abc')
    const cfg = file(s, 'request.curlrc')
    expect(cfg).toContain('url = "https://api.example.com/items?x=1"')
    expect(cfg).toContain('request = "POST"')
    expect(cfg).toContain('header = "X-Evil: $(rm -rf ~); \\"quoted\\" \'single\' `tick`"')
    expect(cfg).toContain('data-binary = "@/tmp/relay-term-abc/body.txt"')
    expect(cfg).toContain('digest')
    expect(cfg).toContain('user = "u:p\\"w"')
    expect(cfg).toContain('insecure')
    expect(cfg).toMatch(/location\nmax-redirs = 10/)
    expect(file(s, 'body.txt')).toBe('{"name":"Иван","q":"a\'b"}')
    // The shell script only runs `curl -K <file>` — request data never reaches the shell.
    const run = file(s, 'run.sh')
    expect(run).toContain(`curl -K '/tmp/relay-term-abc/request.curlrc'`)
    expect(run).not.toContain('rm -rf ~')
    expect(s.entry).toBe('run.sh')
  })

  it('uses --head for HEAD instead of -X HEAD', () => {
    const s = buildTerminalScript('curl', base({ method: 'HEAD', body: { kind: 'none' } }), 'darwin', '/tmp/d')
    expect(file(s, 'request.curlrc')).toMatch(/^head$/m)
    expect(file(s, 'request.curlrc')).not.toContain('request = "HEAD"')
    expect(s.preview).toContain('-I')
    expect(s.entry).toBe('run.command')
  })

  it('sends form fields as literal strings and files by path', () => {
    const s = buildTerminalScript(
      'curl',
      base({ body: { kind: 'form', fields: [{ name: 'note', value: '@/etc/passwd' }, { name: 'doc', filePath: '/home/u/a;b.pdf', contentType: 'application/pdf' }] } }),
      'linux',
      '/tmp/d'
    )
    const cfg = file(s, 'request.curlrc')
    expect(cfg).toContain('form-string = "note=@/etc/passwd"')
    expect(cfg).toContain('form = "doc=@\\"/home/u/a;b.pdf\\";type=application/pdf"')
  })

  it('runs curl.exe from a BOM-prefixed PowerShell script on Windows', () => {
    const s = buildTerminalScript('curl', base(), 'win32', 'C:\\Users\\A B\\AppData\\Local\\Temp\\relay-term-x')
    const run = s.files.find((f) => f.name === 'run.ps1')!
    expect(run.bom).toBe(true)
    expect(run.content).toContain(`& curl.exe -K 'C:\\Users\\A B\\AppData\\Local\\Temp\\relay-term-x\\request.curlrc'`)
    expect(file(s, 'request.curlrc')).toContain('data-binary = "@C:\\\\Users\\\\A B\\\\AppData\\\\Local\\\\Temp\\\\relay-term-x\\\\body.txt"')
    expect(s.preview.startsWith('curl.exe')).toBe(true)
  })

  it('never prints the digest password in the preview', () => {
    const s = buildTerminalScript('curl', base({ credentials: { scheme: 'ntlm', username: 'u', password: 'topsecret' } }), 'linux', '/tmp/d')
    expect(s.preview).not.toContain('topsecret')
    expect(file(s, 'command.txt')).not.toContain('topsecret')
  })
})

describe('HTTPie / wget / PowerShell', () => {
  it('HTTPie on Linux: every argument single-quoted, body from stdin', () => {
    const s = buildTerminalScript('httpie', base(), 'linux', '/tmp/d')
    const run = file(s, 'run.sh')
    expect(run).toContain(`http '--follow' '--max-redirects=10' '--timeout=30' 'POST' 'https://api.example.com/items?x=1'`)
    expect(run).toContain(`'X-Evil:$(rm -rf ~); "quoted" '\\''single'\\'' \`tick\`'`)
    expect(run).toContain(`< '/tmp/d/body.txt'`)
  })

  it('wget has no multipart — says so instead of sending a wrong body', () => {
    const s = buildTerminalScript('wget', base({ body: { kind: 'form', fields: [{ name: 'a', value: '1' }] } }), 'linux', '/tmp/d')
    expect(file(s, 'notes.txt')).toContain('multipart')
    expect(file(s, 'run.sh')).not.toContain('--body')
  })

  it('PowerShell moves restricted headers to parameters and reads the body as bytes', () => {
    const s = buildTerminalScript('powershell', base({ headers: [['Content-Type', 'application/json'], ['User-Agent', 'x'], ['X-A', "it's"]] }), 'win32', 'C:\\t\\d')
    const run = file(s, 'run.ps1')
    expect(run).toContain(`$params.ContentType = 'application/json'`)
    expect(run).toContain(`$params.UserAgent = 'x'`)
    expect(run).toContain(`'X-A' = 'it''s'`)
    expect(run).not.toMatch(/'Content-Type' =/)
    expect(run).toContain(`[System.IO.File]::ReadAllBytes('C:\\t\\d\\body.txt')`)
  })

  it('offers the right tools per OS', () => {
    expect(toolsFor('win32')).toEqual(['curl', 'httpie', 'powershell'])
    expect(toolsFor('linux')).toContain('wget')
  })

  it('removes its own temp folder after the run', () => {
    expect(file(buildTerminalScript('curl', base(), 'linux', '/tmp/d'), 'run.sh')).toContain(`rm -rf -- '/tmp/d'`)
    expect(file(buildTerminalScript('curl', base(), 'win32', 'C:\\t\\d'), 'run.ps1')).toContain(`Remove-Item -LiteralPath 'C:\\t\\d' -Recurse -Force`)
  })
})
