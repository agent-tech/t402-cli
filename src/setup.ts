import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { dirname } from 'path'
import { ENV_PATH } from './env'

const KEYS = [
  { env: 'WALLET_SEED_PHRASE', label: 'Seed Phrase (BIP-39 mnemonic)' },
] as const

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(prompt)
    const stdin = process.stdin
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let input = ''
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode?.(false)
        stdin.removeListener('data', onData)
        stdin.pause()
        process.stderr.write('\n')
        resolve(input)
      } else if (ch === '\x7f' || ch === '\b') {
        input = input.slice(0, -1)
      } else if (ch === '\x03') {
        // Ctrl+C
        stdin.setRawMode?.(false)
        process.exit(130)
      } else {
        input += ch
      }
    }
    stdin.on('data', onData)
  })
}

function loadExisting(): Record<string, string> {
  try {
    const content = readFileSync(ENV_PATH, 'utf8')
    const entries: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      entries[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
    }
    return entries
  } catch {
    return {}
  }
}

function mask(value: string): string {
  if (value.length <= 8) return '****'
  return value.slice(0, 4) + '...' + value.slice(-4)
}

function loadFile(path: string): Record<string, string> {
  const content = readFileSync(path, 'utf8')
  const entries: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const value = trimmed.slice(eqIdx + 1)
    // Only import keys we recognize
    if (KEYS.some((k) => k.env === key)) {
      entries[key] = value
    }
  }
  return entries
}

export async function runSetup(opts?: { fromEnv?: string }): Promise<{ saved: string[] }> {
  const existing = loadExisting()
  const values: Record<string, string> = { ...existing }
  const saved: string[] = []

  if (opts?.fromEnv) {
    const imported = loadFile(opts.fromEnv)
    for (const [k, v] of Object.entries(imported)) {
      values[k] = v
      saved.push(k)
    }
  } else {
    process.stderr.write('tpay setup — configure wallet keys\n')
    process.stderr.write('Keys will be saved to: ' + ENV_PATH + '\n\n')

    for (const key of KEYS) {
      const current = existing[key.env]
      let prompt = `${key.label}`
      if (current) {
        prompt += ` [current: ${mask(current)}, Enter to keep]`
      } else {
        prompt += ` [Enter to skip]`
      }
      prompt += ': '

      const input = await readHidden(prompt)

      if (input) {
        values[key.env] = input
        saved.push(key.env)
      } else if (!current) {
        delete values[key.env]
      }
    }
  }

  // Write file
  mkdirSync(dirname(ENV_PATH), { recursive: true })
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`)
  writeFileSync(ENV_PATH, lines.join('\n') + '\n', { mode: 0o600 })
  chmodSync(ENV_PATH, 0o600)

  process.stderr.write('\n')
  process.stderr.write('WARNING: Keys are stored as plaintext (not encrypted) in:\n')
  process.stderr.write('  ' + ENV_PATH + '\n')
  process.stderr.write('File permissions set to 0600 (owner-only). Do not share this file.\n')

  return { saved }
}
