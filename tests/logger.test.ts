import { describe, it, expect, spyOn, afterEach } from 'bun:test'
import { sanitizeError, createLogger } from '../src/logger'

describe('sanitizeError', () => {
  it('extracts message from Error objects', () => {
    expect(sanitizeError(new Error('something failed'))).toBe('something failed')
  })

  it('returns string values as-is', () => {
    expect(sanitizeError('plain string error')).toBe('plain string error')
  })

  it('handles null/undefined safely', () => {
    expect(sanitizeError(null)).toBe('Unknown error')
    expect(sanitizeError(undefined)).toBe('Unknown error')
  })

  it('never exposes private key values in object spread', () => {
    const fakeKey = '0xdeadbeefdeadbeefdeadbeef'
    const result = sanitizeError({ message: 'ok', privateKey: fakeKey })
    expect(result).not.toContain(fakeKey)
    expect(result).toBe('ok')
  })

  it('handles objects without message', () => {
    const result = sanitizeError({ code: 500 })
    expect(result).toBe('Unknown error')
  })
})

describe('logger', () => {
  afterEach(() => {
    // Restore all spies after each test
    const stderr = process.stderr.write as any
    if (stderr?.mockRestore) stderr.mockRestore()
  })

  it('writes log to stderr', () => {
    const spy = spyOn(process.stderr, 'write')
    const logger = createLogger(false)
    logger.log('hello')
    expect(spy).toHaveBeenCalled()
    const written = (spy.mock.calls[0][0] as string)
    expect(written).toContain('hello')
  })

  it('does not write debug when verbose=false', () => {
    const spy = spyOn(process.stderr, 'write')
    const logger = createLogger(false)
    logger.debug('secret debug')
    expect(spy).not.toHaveBeenCalled()
  })

  it('writes debug to stderr when verbose=true', () => {
    const spy = spyOn(process.stderr, 'write')
    const logger = createLogger(true)
    logger.debug('debug message')
    expect(spy).toHaveBeenCalled()
  })
})
