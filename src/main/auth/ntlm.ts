/**
 * NTLM authentication (MS-NLMP), NTLMv2 flavor, in pure JavaScript.
 *
 * The HTTP engine drives the three-leg handshake:
 *   1. Send `Authorization: NTLM <createType1Message()>`.
 *   2. Server replies 401 with `WWW-Authenticate: NTLM <b64>` (Type 2 challenge);
 *      parse it with `decodeType2Message`.
 *   3. Send `Authorization: NTLM <createType3Message(...)>` (Type 3 authenticate).
 *
 * Pure module: depends only on `node:crypto` and the hand-rolled `./md4`.
 * No electron, no fs, no global state.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { md4 } from './md4'

// NTLM negotiate flags (subset we use).
const NEGOTIATE_UNICODE = 0x00000001
const NEGOTIATE_OEM = 0x00000002
const REQUEST_TARGET = 0x00000004
const NEGOTIATE_NTLM = 0x00000200
const NEGOTIATE_ALWAYS_SIGN = 0x00008000
const NEGOTIATE_EXTENDED_SESSIONSECURITY = 0x00080000

// Default Type 1 flag set (0xe208 in the low 16 bits + extended session security).
const TYPE1_FLAGS =
  NEGOTIATE_UNICODE |
  NEGOTIATE_OEM |
  REQUEST_TARGET |
  NEGOTIATE_NTLM |
  NEGOTIATE_ALWAYS_SIGN |
  NEGOTIATE_EXTENDED_SESSIONSECURITY

const SIGNATURE = Buffer.from('NTLMSSP\0', 'latin1') // 8 bytes incl. terminator

export interface Type2Info {
  challenge: Buffer
  targetInfo: Buffer
  flags: number
  targetName?: string
}

export interface NtlmCreds {
  username: string
  password: string
  domain?: string
  workstation?: string
}

/**
 * Build the Type 1 (NEGOTIATE) message, base64-encoded.
 * Domain/workstation are included as empty security buffers (offset past the
 * 32-byte fixed header), which is the most interoperable form.
 */
export function createType1Message(opts?: { domain?: string; workstation?: string }): string {
  // OEM (latin1) per spec; left empty by default for maximum compatibility.
  const domain = Buffer.from((opts?.domain ?? '').toUpperCase(), 'latin1')
  const workstation = Buffer.from((opts?.workstation ?? '').toUpperCase(), 'latin1')

  const headerLen = 32
  const buf = Buffer.alloc(headerLen + domain.length + workstation.length)

  SIGNATURE.copy(buf, 0)
  buf.writeUInt32LE(1, 8) // message type
  buf.writeUInt32LE(TYPE1_FLAGS, 12)

  // Domain security buffer (len, maxLen, offset).
  const domainOffset = headerLen
  buf.writeUInt16LE(domain.length, 16)
  buf.writeUInt16LE(domain.length, 18)
  buf.writeUInt32LE(domainOffset, 20)

  // Workstation security buffer.
  const wsOffset = domainOffset + domain.length
  buf.writeUInt16LE(workstation.length, 24)
  buf.writeUInt16LE(workstation.length, 26)
  buf.writeUInt32LE(wsOffset, 28)

  domain.copy(buf, domainOffset)
  workstation.copy(buf, wsOffset)

  return buf.toString('base64')
}

/** Read a security buffer (len@off, offset@off+4) and slice the payload. */
function readSecurityBuffer(buf: Buffer, off: number): Buffer {
  const len = buf.readUInt16LE(off)
  const dataOffset = buf.readUInt32LE(off + 4)
  if (len === 0 || dataOffset + len > buf.length) return Buffer.alloc(0)
  return buf.subarray(dataOffset, dataOffset + len)
}

/**
 * Parse a base64 Type 2 (CHALLENGE) message from `WWW-Authenticate: NTLM <b64>`.
 * Extracts the 8-byte server challenge, the negotiate flags, and the TargetInfo
 * (AV pairs) security buffer.
 */
export function decodeType2Message(b64: string): Type2Info {
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 32 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('Invalid NTLM Type 2 message: bad signature')
  }
  if (buf.readUInt32LE(8) !== 2) {
    throw new Error('Invalid NTLM Type 2 message: wrong message type')
  }

  const flags = buf.readUInt32LE(20)
  const challenge = Buffer.from(buf.subarray(24, 32)) // 8-byte server challenge

  // TargetName security buffer at offset 12.
  const targetNameBuf = readSecurityBuffer(buf, 12)
  const targetName =
    targetNameBuf.length > 0
      ? targetNameBuf.toString(flags & NEGOTIATE_UNICODE ? 'utf16le' : 'latin1')
      : undefined

  // TargetInfo security buffer at offset 40 (present when flags advertise it,
  // but we read it whenever the header is large enough to contain it).
  let targetInfo = Buffer.alloc(0)
  if (buf.length >= 48) {
    targetInfo = Buffer.from(readSecurityBuffer(buf, 40))
  }

  return { challenge, targetInfo, flags, targetName }
}

/** NTLMv2 hash: HMAC-MD5(MD4(UTF16LE(password)), UTF16LE(UPPER(user) + domain)). */
function ntowfv2(username: string, password: string, domain: string): Buffer {
  const ntHash = md4(Buffer.from(password, 'utf16le'))
  const identity = Buffer.from(username.toUpperCase() + domain, 'utf16le')
  return createHmac('md5', ntHash).update(identity).digest()
}

/**
 * Build the Type 3 (AUTHENTICATE) message, base64-encoded, using NTLMv2.
 *
 * `fixed` injects a deterministic timestamp and/or client challenge for tests;
 * production calls omit it and we generate a real timestamp + random challenge.
 */
export function createType3Message(
  type2: Type2Info,
  creds: NtlmCreds,
  fixed?: { timestamp?: Buffer; clientChallenge?: Buffer }
): string {
  const domain = creds.domain ?? ''
  const workstation = creds.workstation ?? ''

  const ntlmv2Hash = ntowfv2(creds.username, creds.password, domain)

  // Timestamp: 100ns intervals since 1601-01-01, little-endian (8 bytes).
  let timestamp = fixed?.timestamp
  if (!timestamp) {
    const winTime = (BigInt(Date.now()) + 11644473600000n) * 10000n
    timestamp = Buffer.alloc(8)
    timestamp.writeUInt32LE(Number(winTime & 0xffffffffn), 0)
    timestamp.writeUInt32LE(Number((winTime >> 32n) & 0xffffffffn), 4)
  }

  const clientChallenge = fixed?.clientChallenge ?? randomBytes(8)

  // NTLMv2 blob: header + timestamp + clientChallenge + reserved + targetInfo + reserved.
  const blob = Buffer.concat([
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
    timestamp,
    clientChallenge,
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    type2.targetInfo,
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ])

  // NT proof = HMAC-MD5(ntlmv2Hash, serverChallenge + blob); NT response = proof + blob.
  const ntProof = createHmac('md5', ntlmv2Hash)
    .update(Buffer.concat([type2.challenge, blob]))
    .digest()
  const ntResponse = Buffer.concat([ntProof, blob])

  // LMv2 response = HMAC-MD5(ntlmv2Hash, serverChallenge + clientChallenge) + clientChallenge.
  const lmResponse = Buffer.concat([
    createHmac('md5', ntlmv2Hash)
      .update(Buffer.concat([type2.challenge, clientChallenge]))
      .digest(),
    clientChallenge,
  ])

  // String fields are UTF-16LE because we always negotiate Unicode.
  const domainBuf = Buffer.from(domain, 'utf16le')
  const userBuf = Buffer.from(creds.username, 'utf16le')
  const wsBuf = Buffer.from(workstation, 'utf16le')
  const sessionKey = Buffer.alloc(0)

  const headerLen = 64
  let offset = headerLen

  const lmOffset = offset
  offset += lmResponse.length
  const ntOffset = offset
  offset += ntResponse.length
  const domainOffset = offset
  offset += domainBuf.length
  const userOffset = offset
  offset += userBuf.length
  const wsOffset = offset
  offset += wsBuf.length
  const sessionOffset = offset
  offset += sessionKey.length

  const buf = Buffer.alloc(offset)
  SIGNATURE.copy(buf, 0)
  buf.writeUInt32LE(3, 8) // message type

  // Security buffers: each is (len, maxLen, offset).
  writeSecBuf(buf, 12, lmResponse.length, lmOffset)
  writeSecBuf(buf, 20, ntResponse.length, ntOffset)
  writeSecBuf(buf, 28, domainBuf.length, domainOffset)
  writeSecBuf(buf, 36, userBuf.length, userOffset)
  writeSecBuf(buf, 44, wsBuf.length, wsOffset)
  writeSecBuf(buf, 52, sessionKey.length, sessionOffset)

  // Echo negotiated flags from the Type 2 message.
  buf.writeUInt32LE(type2.flags, 60)

  lmResponse.copy(buf, lmOffset)
  ntResponse.copy(buf, ntOffset)
  domainBuf.copy(buf, domainOffset)
  userBuf.copy(buf, userOffset)
  wsBuf.copy(buf, wsOffset)
  sessionKey.copy(buf, sessionOffset)

  return buf.toString('base64')
}

/** Write a security buffer (len, maxLen=len, offset) at `pos`. */
function writeSecBuf(buf: Buffer, pos: number, len: number, dataOffset: number): void {
  buf.writeUInt16LE(len, pos)
  buf.writeUInt16LE(len, pos + 2)
  buf.writeUInt32LE(dataOffset, pos + 4)
}
