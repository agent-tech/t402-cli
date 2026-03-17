// tests/loader.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'

describe('resolveWalletPlugin', () => {
  it('loads env plugin by default', async () => {
    const { resolveWalletPlugin } = await import('../src/loader')
    delete process.env.WALLET_PROVIDER
    const plugin = await resolveWalletPlugin()
    expect(plugin.name).toBe('env')
  })

  it('loads env plugin when WALLET_PROVIDER=env', async () => {
    process.env.WALLET_PROVIDER = 'env'
    const { resolveWalletPlugin } = await import('../src/loader')
    const plugin = await resolveWalletPlugin()
    expect(plugin.name).toBe('env')
  })

  it('throws for unknown wallet provider', async () => {
    process.env.WALLET_PROVIDER = 'unknown-provider'
    const { resolveWalletPlugin } = await import('../src/loader')
    await expect(resolveWalletPlugin()).rejects.toThrow('Unknown wallet provider')
  })
})

describe('resolveChainPlugin', () => {
  it('resolves evm plugin for base', async () => {
    const { resolveChainPlugin } = await import('../src/loader')
    const plugin = await resolveChainPlugin('base')
    expect(plugin.chains).toContain('base')
  })

  it('resolves evm plugin for bsc', async () => {
    const { resolveChainPlugin } = await import('../src/loader')
    const plugin = await resolveChainPlugin('bsc')
    expect(plugin.chains).toContain('bsc')
  })

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
