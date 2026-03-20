import type { CliContext } from '../types'
import { ValidationError } from '../errors'
import { readStdin } from '../stdin'

export abstract class BaseCommand {
  constructor(protected ctx: CliContext) {}

  protected async readStdinJson<T = Record<string, unknown>>(): Promise<T | null> {
    const stdinData = await readStdin()
    if (!stdinData) return null

    try {
      return JSON.parse(stdinData) as T
    } catch (error) {
      throw new ValidationError('Invalid JSON on stdin', error)
    }
  }

  protected requireArg(value: string | undefined, argName: string): string {
    if (!value) {
      throw new ValidationError(`Missing required argument: ${argName}`)
    }
    return value
  }

  protected requireArgs(args: Record<string, string | undefined>): void {
    const missing = Object.entries(args)
      .filter(([, value]) => !value)
      .map(([key]) => key)

    if (missing.length > 0) {
      throw new ValidationError(`Missing required arguments: ${missing.join(', ')}`)
    }
  }
}
