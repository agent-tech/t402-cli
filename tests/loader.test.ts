// tests/loader.test.ts
import { describe, it, expect } from 'bun:test'

describe('resolveWalletPlugin', () => {
  it('loads env plugin by default', async () => {
    const { resolveWalletPlugin } = await import('../src/loader')
    const plugin = await resolveWalletPlugin()
    expect(plugin.name).toBe('env')
  })
})

describe('resolveChainPlugin', () => {
  it('resolves solana plugin for solana', async () => {
    const { resolveChainPlugin } = await import('../src/loader')
    const plugin = await resolveChainPlugin('solana')
    expect(plugin.chains).toContain('solana')
  })

  it('throws for unknown chain', async () => {
    const { resolveChainPlugin } = await import('../src/loader')
    await expect(resolveChainPlugin('unknown-chain')).rejects.toThrow('No chain plugin found')
  })
})
