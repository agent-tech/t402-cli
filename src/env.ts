// src/env.ts
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { decrypt, CryptoError } from './crypto'
import { readHidden, isTTY } from './prompt'

const ENV_PATH = join(homedir(), '.config', 'tpay', '.env')

export { ENV_PATH }

function parseEnvContent(content: string): void {
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const value = trimmed.slice(eqIdx + 1)
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

export async function loadEnv(): Promise<void> {
  // Intentional bypass: env var takes precedence over encrypted config
  if (process.env.WALLET_SEED_PHRASE) return

  let content: string
  try {
    content = readFileSync(ENV_PATH, 'utf8')
  } catch {
    throw new Error(
      'No wallet configured.\nRun: tpay setup\nOr: WALLET_SEED_PHRASE="..." TPAY_PASSPHRASE="..." tpay setup'
    )
  }

  // Check for encrypted format
  const line = content.split('\n').find((l) => l.trim().startsWith('TPAY_ENCRYPTED='))
  if (line) {
    const blob = line.trim().slice('TPAY_ENCRYPTED='.length)

    // Read passphrase
    let passphrase: string
    if (process.env.TPAY_PASSPHRASE) {
      passphrase = process.env.TPAY_PASSPHRASE
    } else if (!isTTY()) {
      throw new Error('TPAY_PASSPHRASE is not set. Provide via env var or run interactively.')
    } else {
      passphrase = await readHidden('Enter passphrase: ')
    }

    // Clear passphrase from env after reading
    delete process.env.TPAY_PASSPHRASE

    // Decrypt
    let plaintext: string
    try {
      plaintext = decrypt(blob, passphrase)
    } catch (e) {
      if (e instanceof CryptoError) {
        if (e.code === 'wrong-passphrase') {
          throw new Error('Failed to decrypt config — wrong passphrase?')
        }
        throw new Error('Failed to decrypt config — file may be corrupted.')
      }
      throw e
    }

    // Parse decrypted content
    parseEnvContent(plaintext)

    // Post-decrypt validation
    if (!process.env.WALLET_SEED_PHRASE) {
      throw new Error("Decrypted config contains no WALLET_SEED_PHRASE. Re-run 'tpay setup' to reconfigure.")
    }
    return
  }

  // Old plaintext format — reject
  throw new Error("Config format not supported. Please run 'tpay setup' to re-configure your keys.")
}
