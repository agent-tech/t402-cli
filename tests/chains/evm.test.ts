// tests/chains/evm.test.ts
import { describe, it, expect } from 'bun:test'
import { PaymentStatus } from '../../src/types'
import type { PaymentIntentResponse } from '../../src/types'

const MOCK_INTENT: PaymentIntentResponse = {
  intent_id: '3b154135-4091-4f23-b962-4871d7160dea',
  merchant_recipient: '0xa7891083D60C5CAfED30c59b74836BdC77136b48',
  sending_amount: '0.03',
  receiving_amount: '0.02797',
  payer_chain: 'base',
  status: PaymentStatus.AWAITING_PAYMENT,
  created_at: '2025-12-27T14:58:43.313974Z',
  expires_at: '2025-12-27T15:08:43.313881Z',
  fee_breakdown: { platform_fee: '0.00003', platform_fee_percentage: '0.1000%', source_chain: 'base', source_chain_fee: '0.001', target_chain: 'base', target_chain_fee: '0.001', total_fee: '0.00203' },
  payment_requirements: {
    scheme: 'exact',
    network: 'eip155:8453',
    amount: '30000',
    payTo: '0x88F2c900e5aF5ae26C372c5997a1D0bf2bfa4b8d',
    maxTimeoutSeconds: 599,
    asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    extra: { name: 'USD Coin', version: '2' },
  },
}

// Test private key (DO NOT USE IN PRODUCTION — test only)
const TEST_PRIVATE_KEY = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

const mockWallet = {
  name: 'test',
  getSeedPhrase: () => '',
  getEvmPrivateKey: () => TEST_PRIVATE_KEY,
}

describe('EVM chain plugin', () => {
  it('handles base, bsc, base-sepolia', async () => {
    const { default: evmPlugin } = await import('../../src/plugins/chains/evm')
    expect(evmPlugin.chains).toContain('base')
    expect(evmPlugin.chains).toContain('bsc')
    expect(evmPlugin.chains).toContain('base-sepolia')
  })

  it('sign() returns a non-empty base64 string', async () => {
    const { default: evmPlugin } = await import('../../src/plugins/chains/evm')
    const result = await evmPlugin.sign(MOCK_INTENT, mockWallet)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('sign() decodes to valid x402 v2 payload with required fields', async () => {
    const { default: evmPlugin } = await import('../../src/plugins/chains/evm')
    const base64 = await evmPlugin.sign(MOCK_INTENT, mockWallet)
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
    expect(decoded.x402Version).toBe(2)
    expect(decoded.resource.url).toContain(MOCK_INTENT.intent_id)
    expect(decoded.accepted.scheme).toBe('exact')
    expect(decoded.accepted.network).toBe('eip155:8453')
    expect(decoded.accepted.asset).toBe(MOCK_INTENT.payment_requirements.asset)
    expect(decoded.accepted.payTo).toBe(MOCK_INTENT.payment_requirements.payTo)
    expect(decoded.accepted.extra.name).toBe('USD Coin') // full extra passthrough
    expect(decoded.payload.signature).toBeTruthy()
    expect(decoded.payload.authorization.from).toBeTruthy()
    expect(decoded.payload.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('domain uses asset and extra from intent, not hardcoded map', async () => {
    const { default: evmPlugin } = await import('../../src/plugins/chains/evm')
    const customIntent = {
      ...MOCK_INTENT,
      payment_requirements: {
        ...MOCK_INTENT.payment_requirements,
        asset: '0x1234567890123456789012345678901234567890',
        extra: { name: 'Custom Token', version: '3' },
      },
    }
    const base64 = await evmPlugin.sign(customIntent, mockWallet)
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
    expect(decoded.accepted.asset).toBe('0x1234567890123456789012345678901234567890')
    expect(decoded.accepted.extra.name).toBe('Custom Token')
  })

  it('throws if payment_requirements.asset is missing', async () => {
    const { default: evmPlugin } = await import('../../src/plugins/chains/evm')
    const badIntent = {
      ...MOCK_INTENT,
      payment_requirements: { ...MOCK_INTENT.payment_requirements, asset: '' },
    }
    await expect(evmPlugin.sign(badIntent, mockWallet)).rejects.toThrow('payment_requirements.asset missing')
  })
})
