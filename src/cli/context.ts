import type { OutputFormat } from './output'
import { createLogger } from '../logger'
import type { CliContext, RootOptions } from './types'

export function getFormat(opts: RootOptions): OutputFormat {
  return opts.format === 'text' ? 'text' : 'json'
}

export function createCliContext(rootOptions: RootOptions): CliContext {
  const format = getFormat(rootOptions)
  const logger = createLogger(!!rootOptions.verbose)

  return {
    format,
    logger,
    rootOptions,
  }
}
