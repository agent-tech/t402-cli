// src/crypto.ts
import { scryptSync, createCipheriv, createDecipheriv, randomBytes } from 'crypto'

export class CryptoError extends Error {
  code: 'wrong-passphrase' | 'corrupted'
  constructor(code: 'wrong-passphrase' | 'corrupted', message: string) {
    super(message)
    this.name = 'CryptoError'
    this.code = code
  }
}

interface EncryptedBlob {
  version: number
  kdf: string
  N: number
  r: number
  p: number
  keylen: number
  salt: string
  iv: string
  authTag: string
  ciphertext: string
}

const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_MAXMEM = 64 * 1024 * 1024 // 64 MiB — enough for N=32768, r=8, p=1
const KEY_LEN = 32
const IV_LEN = 12
const SALT_LEN = 32

export function encrypt(plaintext: string, passphrase: string): string {
  const salt = randomBytes(SALT_LEN)
  const key = scryptSync(passphrase, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM })
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  const blob: EncryptedBlob = {
    version: 1,
    kdf: 'scrypt',
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    keylen: KEY_LEN,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  }
  return Buffer.from(JSON.stringify(blob)).toString('base64url')
}

export function decrypt(blob: string, passphrase: string): string {
  let parsed: EncryptedBlob
  try {
    parsed = JSON.parse(Buffer.from(blob, 'base64url').toString('utf8'))
  } catch {
    throw new CryptoError('corrupted', 'Failed to parse encrypted blob')
  }

  if (parsed.version !== 1) {
    throw new CryptoError('corrupted', 'Unsupported encryption version')
  }

  try {
    const salt = Buffer.from(parsed.salt, 'hex')
    const iv = Buffer.from(parsed.iv, 'hex')
    const authTag = Buffer.from(parsed.authTag, 'hex')
    const ciphertext = Buffer.from(parsed.ciphertext, 'hex')
    const key = scryptSync(passphrase, salt, parsed.keylen, { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: SCRYPT_MAXMEM })
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
  } catch (e) {
    if (e instanceof CryptoError) throw e
    throw new CryptoError('wrong-passphrase', 'Decryption failed')
  }
}
