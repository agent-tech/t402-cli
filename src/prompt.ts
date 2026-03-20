// src/prompt.ts
export function readHidden(prompt: string): Promise<string> {
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

export function isTTY(): boolean {
  return !!process.stdin.isTTY
}
