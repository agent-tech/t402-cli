import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const ENV_PATH = join(homedir(), '.config', 'tpay', '.env')

export { ENV_PATH }

export function loadEnv(): void {
  let content: string
  try {
    content = readFileSync(ENV_PATH, 'utf8')
  } catch {
    return // file doesn't exist, nothing to load
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const value = trimmed.slice(eqIdx + 1)
    // Don't override explicitly set env vars
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
