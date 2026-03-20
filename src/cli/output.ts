export type OutputFormat = 'json' | 'text'

export function formatText(data: unknown, indent = 0): string {
  if (data === null || data === undefined) return ''
  if (typeof data !== 'object') return String(data)

  const pad = '  '.repeat(indent)
  const entries = Object.entries(data as Record<string, unknown>)
  return entries
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${pad}${k}:\n${v.map((item) => `${pad}  ${item}`).join('\n')}`
      }
      if (typeof v === 'object') {
        return `${pad}${k}:\n${formatText(v, indent + 1)}`
      }
      return `${pad}${k}: ${v}`
    })
    .join('\n')
}

export function output(format: OutputFormat, data: unknown): void {
  if (format === 'text') {
    process.stdout.write(formatText(data) + '\n')
  } else {
    process.stdout.write(JSON.stringify(data) + '\n')
  }
}

export function outputError(format: OutputFormat, error: { toJSON(): unknown; message: string }): void {
  if (format === 'json') {
    output(format, error.toJSON())
  } else {
    output(format, {
      status: 'error',
      message: error.message,
    })
  }
}
