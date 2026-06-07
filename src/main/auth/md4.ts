/**
 * MD4 message-digest algorithm (RFC 1320), implemented in pure JavaScript.
 *
 * Node's `crypto` ships no usable `md4` hash under OpenSSL 3 (it lives in the
 * legacy provider and is disabled by default), yet NTLM's NT hash is defined as
 * `MD4(UTF-16LE(password))`. So we hand-roll MD4 here.
 *
 * Pure module: depends only on `node:buffer` (via the global Buffer). No state.
 */

/** Left-rotate a 32-bit word by `n` bits. */
function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0
}

// Round functions.
function f(x: number, y: number, z: number): number {
  return (x & y) | (~x & z)
}
function g(x: number, y: number, z: number): number {
  return (x & y) | (x & z) | (y & z)
}
function h(x: number, y: number, z: number): number {
  return x ^ y ^ z
}

/** Raw 16-byte MD4 digest of `data`. */
export function md4(data: Buffer): Buffer {
  const msgLen = data.length

  // Padding: 0x80, then zeros, until length ≡ 56 (mod 64), then 64-bit LE bit length.
  const padLen = msgLen % 64 < 56 ? 56 - (msgLen % 64) : 120 - (msgLen % 64)
  const totalLen = msgLen + padLen + 8
  const buf = Buffer.alloc(totalLen)
  data.copy(buf, 0)
  buf[msgLen] = 0x80

  // 64-bit message length in bits, little-endian.
  const bitLen = BigInt(msgLen) * 8n
  buf.writeUInt32LE(Number(bitLen & 0xffffffffn), totalLen - 8)
  buf.writeUInt32LE(Number((bitLen >> 32n) & 0xffffffffn), totalLen - 4)

  // Initial register values.
  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  const x = new Array<number>(16)

  for (let off = 0; off < totalLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      x[i] = buf.readUInt32LE(off + i * 4)
    }

    const aa = a
    const bb = b
    const cc = c
    const dd = d

    // Round 1: F, shifts 3,7,11,19.
    const r1 = [3, 7, 11, 19]
    for (let i = 0; i < 16; i++) {
      const s = r1[i % 4]
      const k = i
      const val = (a + f(b, c, d) + x[k]) >>> 0
      const t = rotl(val, s)
      a = d
      d = c
      c = b
      b = t
    }

    // Round 2: G, constant 0x5a827999, shifts 3,5,9,13, index order 0,4,8,12,1,...
    const r2 = [3, 5, 9, 13]
    const o2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15]
    for (let i = 0; i < 16; i++) {
      const s = r2[i % 4]
      const k = o2[i]
      const val = (a + g(b, c, d) + x[k] + 0x5a827999) >>> 0
      const t = rotl(val, s)
      a = d
      d = c
      c = b
      b = t
    }

    // Round 3: H, constant 0x6ed9eba1, shifts 3,9,11,15, index order 0,8,4,12,2,...
    const r3 = [3, 9, 11, 15]
    const o3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15]
    for (let i = 0; i < 16; i++) {
      const s = r3[i % 4]
      const k = o3[i]
      const val = (a + h(b, c, d) + x[k] + 0x6ed9eba1) >>> 0
      const t = rotl(val, s)
      a = d
      d = c
      c = b
      b = t
    }

    a = (a + aa) >>> 0
    b = (b + bb) >>> 0
    c = (c + cc) >>> 0
    d = (d + dd) >>> 0
  }

  const out = Buffer.alloc(16)
  out.writeUInt32LE(a >>> 0, 0)
  out.writeUInt32LE(b >>> 0, 4)
  out.writeUInt32LE(c >>> 0, 8)
  out.writeUInt32LE(d >>> 0, 12)
  return out
}
