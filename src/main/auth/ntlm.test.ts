import { describe, it, expect } from 'vitest'
import { md4 } from './md4'
import {
  createType1Message,
  decodeType2Message,
  createType3Message,
  type Type2Info,
} from './ntlm'

const SIGNATURE = Buffer.from('NTLMSSP\0', 'latin1')

/** Build a minimal but valid Type 2 fixture for round-trip decoding tests. */
function createType2Fixture(challenge: Buffer, targetInfo: Buffer): string {
  const flags = 0x00080205 // unicode | oem | request-target + extended session security
  const headerLen = 48
  const targetName = Buffer.alloc(0)
  const targetNameOffset = headerLen
  const targetInfoOffset = targetNameOffset + targetName.length

  const buf = Buffer.alloc(headerLen + targetName.length + targetInfo.length)
  SIGNATURE.copy(buf, 0)
  buf.writeUInt32LE(2, 8) // message type 2

  // TargetName security buffer (empty here).
  buf.writeUInt16LE(targetName.length, 12)
  buf.writeUInt16LE(targetName.length, 14)
  buf.writeUInt32LE(targetNameOffset, 16)

  buf.writeUInt32LE(flags, 20)
  challenge.copy(buf, 24) // 8-byte server challenge
  // bytes 32..40: reserved (8 zero bytes)

  // TargetInfo security buffer at offset 40.
  buf.writeUInt16LE(targetInfo.length, 40)
  buf.writeUInt16LE(targetInfo.length, 42)
  buf.writeUInt32LE(targetInfoOffset, 44)

  targetName.copy(buf, targetNameOffset)
  targetInfo.copy(buf, targetInfoOffset)

  return buf.toString('base64')
}

/** Encode one AV pair (avId uint16 LE, avLen uint16 LE, value). */
function avPair(id: number, value: Buffer): Buffer {
  const head = Buffer.alloc(4)
  head.writeUInt16LE(id, 0)
  head.writeUInt16LE(value.length, 2)
  return Buffer.concat([head, value])
}

describe('md4', () => {
  it('hashes the empty string', () => {
    expect(md4(Buffer.from('')).toString('hex')).toBe('31d6cfe0d16ae931b73c59d7e0c089c0')
  })

  it('hashes "abc"', () => {
    expect(md4(Buffer.from('abc')).toString('hex')).toBe('a448017aaf21d8525fc10ae87aa6729d')
  })

  it('hashes "message digest"', () => {
    expect(md4(Buffer.from('message digest')).toString('hex')).toBe(
      'd9130a8164549fe818874806e1c7014b'
    )
  })

  it('produces the canonical MS-NLMP NT hash', () => {
    // NT hash = MD4(UTF-16LE(password)). The well-known MS-NLMP / SMB test
    // vector 8846f7eaee8fb117ad06bdd830b7586c is the hash of the lowercase
    // password "password" (NTLM password hashing is case-sensitive).
    expect(md4(Buffer.from('password', 'utf16le')).toString('hex')).toBe(
      '8846f7eaee8fb117ad06bdd830b7586c'
    )
  })
})

describe('createType1Message', () => {
  it('round-trips to a buffer starting with NTLMSSP\\0 and message type 1', () => {
    const b64 = createType1Message()
    const buf = Buffer.from(b64, 'base64')
    expect(buf.subarray(0, 8).equals(SIGNATURE)).toBe(true)
    expect(buf.readUInt32LE(8)).toBe(1)
  })
})

describe('decodeType2Message', () => {
  it('extracts the challenge and targetInfo from a fixture', () => {
    const challenge = Buffer.from('0123456789abcdef', 'hex')
    const targetInfo = Buffer.concat([
      avPair(0x0002, Buffer.from('DOMAIN', 'utf16le')), // MsvAvNbDomainName
      avPair(0x0001, Buffer.from('SERVER', 'utf16le')), // MsvAvNbComputerName
      avPair(0x0000, Buffer.alloc(0)), // MsvAvEOL
    ])
    const b64 = createType2Fixture(challenge, targetInfo)

    const info = decodeType2Message(b64)
    expect(info.challenge.equals(challenge)).toBe(true)
    expect(info.targetInfo.equals(targetInfo)).toBe(true)
    expect(info.challenge.length).toBe(8)
  })
})

describe('createType3Message', () => {
  const challenge = Buffer.from('0123456789abcdef', 'hex')
  const targetInfo = Buffer.concat([
    avPair(0x0002, Buffer.from('DOMAIN', 'utf16le')),
    avPair(0x0001, Buffer.from('SERVER', 'utf16le')),
    avPair(0x0000, Buffer.alloc(0)),
  ])
  const type2: Type2Info = {
    challenge,
    targetInfo,
    flags: 0x00080205,
  }

  it('round-trips: NTLMv2 NT response > 24 bytes, domain/user decode back', () => {
    const b64 = createType3Message(type2, {
      username: 'user',
      password: 'password',
      domain: 'DOMAIN',
      workstation: 'WORKSTATION',
    })
    const buf = Buffer.from(b64, 'base64')

    expect(buf.subarray(0, 8).equals(SIGNATURE)).toBe(true)
    expect(buf.readUInt32LE(8)).toBe(3)

    // NT response security buffer at offset 20.
    const ntLen = buf.readUInt16LE(20)
    expect(ntLen).toBeGreaterThan(24) // NTLMv2 is much longer than the 24-byte v1 response

    // Domain field at offset 28.
    const domLen = buf.readUInt16LE(28)
    const domOff = buf.readUInt32LE(32)
    expect(buf.subarray(domOff, domOff + domLen).toString('utf16le')).toBe('DOMAIN')

    // User field at offset 36.
    const userLen = buf.readUInt16LE(36)
    const userOff = buf.readUInt32LE(40)
    expect(buf.subarray(userOff, userOff + userLen).toString('utf16le')).toBe('user')

    // Workstation field at offset 44.
    const wsLen = buf.readUInt16LE(44)
    const wsOff = buf.readUInt32LE(48)
    expect(buf.subarray(wsOff, wsOff + wsLen).toString('utf16le')).toBe('WORKSTATION')
  })

  it('is deterministic with a fixed timestamp and client challenge', () => {
    const b64 = createType3Message(
      type2,
      {
        username: 'user',
        password: 'password',
        domain: 'DOMAIN',
        workstation: 'WORKSTATION',
      },
      {
        timestamp: Buffer.alloc(8), // all zeros
        clientChallenge: Buffer.from('aaaaaaaaaaaaaaaa', 'hex'),
      }
    )

    // Snapshot: guards against accidental regressions in the crypto pipeline.
    expect(b64).toBe(
      'TlRMTVNTUAADAAAAGAAYAEAAAABUAFQAWAAAAAwADACsAAAACAAIALgAAAAWABYAwAAAAAAAAADWAAAABQIIAPdGevyAuWfo+/65qIRlEFCqqqqqqqqqqrXhD0iPL9frEl2mnQb0CjgBAQAAAAAAAAAAAAAAAAAAqqqqqqqqqqoAAAAAAgAMAEQATwBNAEEASQBOAAEADABTAEUAUgBWAEUAUgAAAAAAAAAAAEQATwBNAEEASQBOAHUAcwBlAHIAVwBPAFIASwBTAFQAQQBUAEkATwBOAA=='
    )
  })
})
