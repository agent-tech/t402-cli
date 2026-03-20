// src/seedphrase.ts
import { validateMnemonic } from 'bip39'

const VALID_WORD_COUNTS = [12, 15, 18, 21, 24]

export class SeedPhraseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedPhraseError'
  }
}

/**
 * Validate a BIP-39 seed phrase.
 * Throws SeedPhraseError if invalid.
 */
export function validateSeedPhrase(phrase: string): void {
  const trimmed = phrase.trim()
  if (!trimmed) {
    throw new SeedPhraseError('Seed phrase cannot be empty.')
  }

  const words = trimmed.split(/\s+/)

  if (words.length < 12) {
    throw new SeedPhraseError(
      `Seed phrase must have at least 12 words (got ${words.length}).`
    )
  }

  if (!VALID_WORD_COUNTS.includes(words.length)) {
    throw new SeedPhraseError(
      `Seed phrase must be 12, 15, 18, 21, or 24 words (got ${words.length}).`
    )
  }

  // Normalize to single-space separated lowercase
  const normalized = words.join(' ').toLowerCase()

  if (!validateMnemonic(normalized)) {
    throw new SeedPhraseError(
      'Invalid seed phrase — check spelling and word order.'
    )
  }
}
