import { describe, it, expect } from 'vitest'
import { createType3Message, type3Flags, type Type2Info } from './ntlm'

/**
 * MS-NLMP: the AUTHENTICATE (Type 3) message must not advertise capabilities it
 * does not carry. Our message has no Version field (it uses the 64-byte header
 * form, so the payload starts where Version would live) and an empty
 * EncryptedRandomSessionKey, and we neither sign nor seal — so echoing the
 * server's NEGOTIATE_VERSION / KEY_EXCH / SIGN / SEAL bits back describes a
 * message that does not exist. SSPI-based servers reject that with
 * SEC_E_INVALID_TOKEN.
 */
const NEGOTIATE_UNICODE = 0x00000001
const NEGOTIATE_SIGN = 0x00000010
const NEGOTIATE_SEAL = 0x00000020
const NEGOTIATE_DATAGRAM = 0x00000040
const NEGOTIATE_LM_KEY = 0x00000080
const NEGOTIATE_NTLM = 0x00000200
const NEGOTIATE_ALWAYS_SIGN = 0x00008000
const NEGOTIATE_EXTENDED_SESSIONSECURITY = 0x00080000
const NEGOTIATE_TARGET_INFO = 0x00800000
const NEGOTIATE_VERSION = 0x02000000
const NEGOTIATE_128 = 0x20000000
const NEGOTIATE_KEY_EXCH = 0x40000000

describe('type3Flags', () => {
  it('drops the capabilities the Type 3 message cannot back up', () => {
    const serverFlags =
      NEGOTIATE_UNICODE |
      NEGOTIATE_SIGN |
      NEGOTIATE_SEAL |
      NEGOTIATE_DATAGRAM |
      NEGOTIATE_LM_KEY |
      NEGOTIATE_NTLM |
      NEGOTIATE_ALWAYS_SIGN |
      NEGOTIATE_EXTENDED_SESSIONSECURITY |
      NEGOTIATE_TARGET_INFO |
      NEGOTIATE_VERSION |
      NEGOTIATE_128 |
      NEGOTIATE_KEY_EXCH

    const flags = type3Flags(serverFlags)

    expect(flags & NEGOTIATE_VERSION).toBe(0)
    expect(flags & NEGOTIATE_KEY_EXCH).toBe(0)
    expect(flags & NEGOTIATE_SIGN).toBe(0)
    expect(flags & NEGOTIATE_SEAL).toBe(0)
    expect(flags & NEGOTIATE_DATAGRAM).toBe(0)
    expect(flags & NEGOTIATE_LM_KEY).toBe(0)
  })

  it('keeps everything the message really negotiates', () => {
    const flags = type3Flags(0xffffffff)
    expect(flags & NEGOTIATE_UNICODE).toBe(NEGOTIATE_UNICODE)
    expect(flags & NEGOTIATE_NTLM).toBe(NEGOTIATE_NTLM)
    expect(flags & NEGOTIATE_ALWAYS_SIGN).toBe(NEGOTIATE_ALWAYS_SIGN)
    expect(flags & NEGOTIATE_EXTENDED_SESSIONSECURITY).toBe(NEGOTIATE_EXTENDED_SESSIONSECURITY)
    expect(flags & NEGOTIATE_TARGET_INFO).toBe(NEGOTIATE_TARGET_INFO)
    expect(flags & NEGOTIATE_128).toBe(NEGOTIATE_128)
  })

  it('returns an unsigned 32-bit value (never a negative int32)', () => {
    expect(type3Flags(0xffffffff)).toBeGreaterThan(0)
  })

  it('leaves an already-safe flag set untouched', () => {
    const safe = NEGOTIATE_UNICODE | 0x00000004 | NEGOTIATE_NTLM | NEGOTIATE_EXTENDED_SESSIONSECURITY
    expect(type3Flags(safe)).toBe(safe)
  })
})

describe('createType3Message — flags on the wire', () => {
  const type2: Type2Info = {
    challenge: Buffer.from('0123456789abcdef', 'hex'),
    targetInfo: Buffer.alloc(4),
    flags: NEGOTIATE_UNICODE | NEGOTIATE_NTLM | NEGOTIATE_VERSION | NEGOTIATE_KEY_EXCH
  }

  it('writes the masked flags at offset 60', () => {
    const buf = Buffer.from(
      createType3Message(type2, { username: 'u', password: 'p', domain: 'D' }),
      'base64'
    )
    const flags = buf.readUInt32LE(60)
    expect(flags & NEGOTIATE_VERSION).toBe(0)
    expect(flags & NEGOTIATE_KEY_EXCH).toBe(0)
    expect(flags & NEGOTIATE_NTLM).toBe(NEGOTIATE_NTLM)
  })

  it('keeps the payload starting at offset 64 (no Version field is emitted)', () => {
    const buf = Buffer.from(
      createType3Message(type2, { username: 'u', password: 'p', domain: 'D' }),
      'base64'
    )
    // LmChallengeResponse is the first payload field.
    expect(buf.readUInt32LE(16)).toBe(64)
  })
})
