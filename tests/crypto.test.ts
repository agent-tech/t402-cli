// tests/crypto.test.ts
import { describe, it, expect } from 'bun:test'
import { encrypt, decrypt, CryptoError } from '../src/crypto'

describe('encrypt/decrypt', () => {
  const plaintext = 'WALLET_SEED_PHRASE=abandon abandon abandon\n'
  const passphrase = 'test-passphrase'

  it('round-trips correctly with the right passphrase', () => {
    const blob = encrypt(plaintext, passphrase)
    const result = decrypt(blob, passphrase)
    expect(result).toBe(plaintext)
  })

  it('produces different ciphertext each call (random salt + IV)', () => {
    const blob1 = encrypt(plaintext, passphrase)
    const blob2 = encrypt(plaintext, passphrase)
    expect(blob1).not.toBe(blob2)
  })

  it('throws CryptoError with code wrong-passphrase on bad passphrase', () => {
    const blob = encrypt(plaintext, passphrase)
    try {
      decrypt(blob, 'wrong-passphrase')
      expect(true).toBe(false) // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(CryptoError)
      expect((e as CryptoError).code).toBe('wrong-passphrase')
    }
  })

  it('throws CryptoError with code corrupted on malformed blob', () => {
    try {
      decrypt('not-valid-base64-json', passphrase)
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(CryptoError)
      expect((e as CryptoError).code).toBe('corrupted')
    }
  })

  it('throws CryptoError with code corrupted on unknown version', () => {
    const blob = encrypt(plaintext, passphrase)
    // Decode, modify version, re-encode
    const json = JSON.parse(Buffer.from(blob, 'base64url').toString('utf8'))
    json.version = 99
    const tampered = Buffer.from(JSON.stringify(json)).toString('base64url')
    try {
      decrypt(tampered, passphrase)
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(CryptoError)
      expect((e as CryptoError).code).toBe('corrupted')
    }
  })

  it('error messages never contain the passphrase or plaintext', () => {
    const blob = encrypt(plaintext, passphrase)
    try {
      decrypt(blob, 'wrong')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).not.toContain(passphrase)
      expect(msg).not.toContain(plaintext)
      expect(msg).not.toContain('abandon')
    }
  })
})
