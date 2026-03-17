export function sanitizeError(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    if ('message' in e && typeof (e as any).message === 'string') {
      return (e as any).message
    }
  }
  return 'Unknown error'
}

export interface Logger {
  log(message: string, data?: unknown): void
  debug(message: string, data?: unknown): void
}

export function createLogger(verbose: boolean): Logger {
  function write(prefix: string, message: string, data?: unknown) {
    const line = data !== undefined
      ? `[${prefix}] ${message} ${JSON.stringify(data)}\n`
      : `[${prefix}] ${message}\n`
    process.stderr.write(line)
  }

  return {
    log(message, data) {
      write('info', message, data)
    },
    debug(message, data) {
      if (verbose) write('debug', message, data)
    },
  }
}

// Default singleton — replaced in index.ts after parsing --verbose
export let logger: Logger = createLogger(false)
export function setLogger(l: Logger) { logger = l }
