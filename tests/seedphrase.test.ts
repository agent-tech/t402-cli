// tests/seedphrase.test.ts
import { describe, it, expect } from 'bun:test'
import { validateSeedPhrase, SeedPhraseError } from '../src/seedphrase'

// Valid 12-word BIP-39 mnemonic (all "abandon" × 11 + "about")
const VALID_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// Valid 24-word mnemonic
const VALID_24 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'

describe('validateSeedPhrase', () => {
  it('accepts a valid 12-word mnemonic', () => {
    expect(() => validateSeedPhrase(VALID_12)).not.toThrow()
  })

  it('accepts a valid 24-word mnemonic', () => {
    expect(() => validateSeedPhrase(VALID_24)).not.toThrow()
  })

  it('accepts mnemonic with extra whitespace', () => {
    const padded = '  ' + VALID_12.replace(/ /g, '   ') + '  '
    expect(() => validateSeedPhrase(padded)).not.toThrow()
  })

  it('rejects empty string', () => {
    expect(() => validateSeedPhrase('')).toThrow(SeedPhraseError)
    expect(() => validateSeedPhrase('   ')).toThrow(SeedPhraseError)
  })

  it('rejects fewer than 12 words', () => {
    try {
      validateSeedPhrase('abandon abandon abandon')
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(SeedPhraseError)
      expect((e as SeedPhraseError).message).toContain('at least 12 words')
    }
  })

  it('rejects invalid word count (13 words)', () => {
    const thirteen = VALID_12 + ' abandon'
    try {
      validateSeedPhrase(thirteen)
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(SeedPhraseError)
      expect((e as SeedPhraseError).message).toContain('12, 15, 18, 21, or 24')
    }
  })

  it('rejects words not in BIP-39 wordlist', () => {
    const bad = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zzzznotaword'
    try {
      validateSeedPhrase(bad)
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(SeedPhraseError)
      expect((e as SeedPhraseError).message).toContain('Invalid seed phrase')
    }
  })

  it('rejects valid words with bad checksum', () => {
    // All 12 "abandon" — invalid checksum
    const badChecksum = Array(12).fill('abandon').join(' ')
    try {
      validateSeedPhrase(badChecksum)
      expect(true).toBe(false)
    } catch (e) {
      expect(e).toBeInstanceOf(SeedPhraseError)
      expect((e as SeedPhraseError).message).toContain('Invalid seed phrase')
    }
  })

  it('error message never contains the seed phrase', () => {
    try {
      validateSeedPhrase('abandon abandon abandon')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).not.toContain('abandon')
    }
  })
})
