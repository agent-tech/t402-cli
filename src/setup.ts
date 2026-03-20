// src/setup.ts
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname } from 'path'
import { ENV_PATH } from './env'
import { readHidden, isTTY } from './prompt'
import { encrypt } from './crypto'

function loadFile(path: string): string | undefined {
  const content = readFileSync(path, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    if (key === 'WALLET_SEED_PHRASE') return trimmed.slice(eqIdx + 1)
  }
  return undefined
}

export async function runSetup(opts?: { fromEnv?: string }): Promise<{ saved: string[] }> {
  // Step 1 — Overwrite check
  if (existsSync(ENV_PATH)) {
    const bothSet = !!process.env.WALLET_SEED_PHRASE && !!process.env.TPAY_PASSPHRASE
    if (bothSet) {
      // Non-interactive overwrite — proceed silently
    } else if (!isTTY()) {
      throw new Error('Existing config found. Set WALLET_SEED_PHRASE and TPAY_PASSPHRASE to overwrite non-interactively.')
    } else {
      const answer = await readHidden('Existing config found. Overwrite? [y/N]: ')
      if (answer.toLowerCase() !== 'y') {
        process.stderr.write('Setup cancelled.\n')
        process.exitCode = 0
        return { saved: [] }
      }
    }
  }

  // Step 2 — Seed phrase
  let seedPhrase: string
  if (opts?.fromEnv) {
    const imported = loadFile(opts.fromEnv)
    if (!imported) throw new Error(`No WALLET_SEED_PHRASE found in ${opts.fromEnv}`)
    seedPhrase = imported
  } else if (process.env.WALLET_SEED_PHRASE) {
    seedPhrase = process.env.WALLET_SEED_PHRASE
  } else if (!isTTY()) {
    throw new Error('WALLET_SEED_PHRASE is not set. Provide via env var or run interactively.')
  } else {
    process.stderr.write('tpay setup — configure wallet keys\n')
    process.stderr.write('Keys will be encrypted and saved to: ' + ENV_PATH + '\n\n')
    seedPhrase = await readHidden('Enter seed phrase: ')
    const confirm = await readHidden('Confirm seed phrase: ')
    if (seedPhrase !== confirm) throw new Error('Seed phrases do not match.')
  }

  // Step 3 — Passphrase
  let passphrase: string
  if (process.env.TPAY_PASSPHRASE) {
    passphrase = process.env.TPAY_PASSPHRASE
  } else if (!isTTY()) {
    throw new Error('TPAY_PASSPHRASE is not set. Provide via env var or run interactively.')
  } else {
    passphrase = await readHidden('Choose an encryption passphrase: ')
    if (!passphrase) throw new Error('Passphrase cannot be empty.')
    const confirm = await readHidden('Confirm passphrase: ')
    if (passphrase !== confirm) throw new Error('Passphrases do not match.')
  }

  // Step 4 — Encrypt & save
  const plaintext = `WALLET_SEED_PHRASE=${seedPhrase}\n`
  const blob = encrypt(plaintext, passphrase)

  mkdirSync(dirname(ENV_PATH), { recursive: true })
  writeFileSync(ENV_PATH, `TPAY_ENCRYPTED=${blob}\n`, { mode: 0o600 })

  process.stderr.write('\nKeys encrypted and saved to ' + ENV_PATH + '\n')
  process.stderr.write('Set TPAY_PASSPHRASE in your environment to skip the passphrase prompt.\n')

  return { saved: ['WALLET_SEED_PHRASE'] }
}
