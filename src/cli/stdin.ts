const DEFAULT_STDIN_TIMEOUT_MS = 1000

export interface ReadStdinOptions {
  timeoutMs?: number
  silent?: boolean
}

export async function readStdin(options: ReadStdinOptions = {}): Promise<string> {
  const { timeoutMs = DEFAULT_STDIN_TIMEOUT_MS, silent = false } = options

  return new Promise((resolve) => {
    let data = ''
    let didTimeout = false

    const timer = setTimeout(() => {
      didTimeout = true
      process.stdin.off('data', onData)
      process.stdin.off('end', onEnd)

      if (!silent && data.length === 0) {
        process.stderr.write('[warn] stdin read timeout, continuing without input\n')
      }

      resolve(data.trim())
    }, timeoutMs)

    function onData(chunk: string) {
      data += chunk
    }

    function onEnd() {
      if (!didTimeout) {
        clearTimeout(timer)
        resolve(data.trim())
      }
    }

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
  })
}
