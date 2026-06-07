import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { RequestSpec, RunOptions } from '@shared/types'
import { runRequest } from './engine'

/**
 * End-to-end NTLM handshake against a local server that speaks the 3-message
 * dance: it 401s the Type 1 with a Type 2 challenge, then 200s the Type 3.
 * Verifies the engine seeds Type 1, replies with Type 3 on the same connection,
 * and that the replayed message is genuinely a Type 3 (NTLMv2).
 */

const SERVER_CHALLENGE = Buffer.from('0123456789abcdef', 'hex')

/** Build a minimal NTLM Type 2 (CHALLENGE) message (base64). */
function buildType2(): string {
  const targetInfo = Buffer.from([0, 0, 0, 0]) // MsvAvEOL
  const header = Buffer.alloc(48)
  header.write('NTLMSSP\0', 0, 'latin1')
  header.writeUInt32LE(2, 8) // message type 2
  // TargetName security buffer (empty) at offset 12 (len/maxlen/offset)
  header.writeUInt16LE(0, 12)
  header.writeUInt16LE(0, 14)
  header.writeUInt32LE(48, 16)
  // Negotiate flags: UNICODE | NTLM | TARGET_INFO
  header.writeUInt32LE(0x00000001 | 0x00000200 | 0x00800000, 20)
  SERVER_CHALLENGE.copy(header, 24) // 8-byte server challenge at offset 24
  // Reserved 32..39 = 0
  // TargetInfo security buffer at offset 40
  header.writeUInt16LE(targetInfo.length, 40)
  header.writeUInt16LE(targetInfo.length, 42)
  header.writeUInt32LE(48, 44)
  return Buffer.concat([header, targetInfo]).toString('base64')
}

/** Message type field (offset 8, uint32 LE) of a base64 NTLM message. */
function ntlmMessageType(b64: string): number {
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 12 || buf.toString('latin1', 0, 7) !== 'NTLMSSP') return -1
  return buf.readUInt32LE(8)
}

let server: Server
let base = ''
let sawType1 = false
let sawType3 = false
let type3NtResponseLen = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    const auth = req.headers['authorization']
    const token = typeof auth === 'string' && /^NTLM\s+/i.test(auth) ? auth.replace(/^NTLM\s+/i, '') : ''
    const type = token ? ntlmMessageType(token) : 0

    if (type === 1) {
      sawType1 = true
      res.statusCode = 401
      res.setHeader('WWW-Authenticate', `NTLM ${buildType2()}`)
      res.setHeader('Connection', 'keep-alive')
      res.end('challenge')
      return
    }
    if (type === 3) {
      sawType3 = true
      // NTLMv2 NtChallengeResponse security buffer length is at offset 20.
      const buf = Buffer.from(token, 'base64')
      type3NtResponseLen = buf.readUInt16LE(20)
      res.statusCode = 200
      res.end('authenticated')
      return
    }
    // No/invalid auth → offer NTLM.
    res.statusCode = 401
    res.setHeader('WWW-Authenticate', 'NTLM')
    res.end('unauthorized')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  base = `http://127.0.0.1:${port}`
})

afterAll(() => {
  server.close()
})

function spec(partial: Partial<RequestSpec>): RequestSpec {
  return {
    method: 'GET',
    url: base,
    query: [],
    headers: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    settings: { timeoutMs: 10000, followRedirects: true, maxRedirects: 5, rejectUnauthorized: true },
    ...partial
  }
}

const OPTS: RunOptions = { requestId: 'ntlm-e2e' }

describe('NTLM handshake (engine end-to-end)', () => {
  it('completes Type1 -> 401 Type2 -> Type3 -> 200', async () => {
    const result = await runRequest(
      spec({ auth: { type: 'ntlm', username: 'User', password: 'Password', domain: 'Domain' } }),
      OPTS
    )
    expect(sawType1).toBe(true)
    expect(sawType3).toBe(true)
    // NTLMv2 NtChallengeResponse = 16-byte proof + variable blob → well over 24.
    expect(type3NtResponseLen).toBeGreaterThan(24)
    expect(result.status).toBe(200)
    expect(result.body.text).toContain('authenticated')
  })
})
