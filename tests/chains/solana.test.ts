// tests/chains/solana.test.ts
import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test'
import { Connection } from '@solana/web3.js'
import { PaymentStatus } from '../../src/types'
import type { PaymentIntentResponse } from '../../src/types'

const MOCK_INTENT: PaymentIntentResponse = {
  intent_id: '88cbc41d-fc26-47c1-9210-f211de6147b4',
  merchant_recipient: '0x6f2aCe54729af35Bf8Ab099b74Ed067B7212E544',
  sending_amount: '0.03',
  receiving_amount: '0.02797',
  payer_chain: 'solana',
  status: PaymentStatus.AWAITING_PAYMENT,
  created_at: '2025-12-27T15:32:18.469242Z',
  expires_at: '2025-12-27T15:42:18.464914Z',
  fee_breakdown: { platform_fee: '0.00003', platform_fee_percentage: '0.1000%', source_chain: 'solana', source_chain_fee: '0.001', target_chain: 'base', target_chain_fee: '0.001', total_fee: '0.00203' },
  payment_requirements: {
    scheme: 'exact',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    amount: '30000',
    payTo: '7F3aWqfBt9MHEF96hz87fvoSE4BaYCwTwHoi19bJBjC8',
    maxTimeoutSeconds: 599,
    asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    extra: { feePayer: 'L54zkaPQFeTn1UsEqieEXBqWrPShiaZEPD7mS5WXfQg', decimals: 6 },
  },
}

// 64-byte test seed (DO NOT USE IN PRODUCTION)
const TEST_SEED = new Uint8Array(64).fill(1)

const mockWallet = {
  name: 'test',
  getEvmPrivateKey: () => '0x0000',
  getSolanaSeed: () => TEST_SEED,
}

// Mock the RPC call to avoid network requests in tests
const MOCK_BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'
const originalGetLatestBlockhash = Connection.prototype.getLatestBlockhash

beforeAll(() => {
  Connection.prototype.getLatestBlockhash = async () => ({
    blockhash: MOCK_BLOCKHASH,
    lastValidBlockHeight: 100,
  })
})

afterAll(() => {
  Connection.prototype.getLatestBlockhash = originalGetLatestBlockhash
})

describe('Solana chain plugin', () => {
  it('handles solana and solana-devnet', async () => {
    const { default: solanaPlugin } = await import('../../src/plugins/chains/solana')
    expect(solanaPlugin.chains).toContain('solana')
    expect(solanaPlugin.chains).toContain('solana-devnet')
  })

  it('sign() returns a non-empty base64 string', async () => {
    const { default: solanaPlugin } = await import('../../src/plugins/chains/solana')
    const result = await solanaPlugin.sign(MOCK_INTENT, mockWallet)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('sign() decodes to valid x402 v2 payload with required fields', async () => {
    const { default: solanaPlugin } = await import('../../src/plugins/chains/solana')
    const base64 = await solanaPlugin.sign(MOCK_INTENT, mockWallet)
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
    expect(decoded.x402Version).toBe(2)
    expect(decoded.resource.url).toContain(MOCK_INTENT.intent_id)
    expect(decoded.accepted.network).toBe('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
    expect(decoded.accepted.asset).toBe(MOCK_INTENT.payment_requirements.asset)
    expect(decoded.payload.transaction).toBeTruthy()
  })

  it('accepted.extra contains ONLY feePayer — no other fields', async () => {
    const { default: solanaPlugin } = await import('../../src/plugins/chains/solana')
    const base64 = await solanaPlugin.sign(MOCK_INTENT, mockWallet)
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
    const extraKeys = Object.keys(decoded.accepted.extra)
    expect(extraKeys).toEqual(['feePayer'])
    expect(decoded.accepted.extra.feePayer).toBe('L54zkaPQFeTn1UsEqieEXBqWrPShiaZEPD7mS5WXfQg')
  })

  it('uses feePayer from intent.payment_requirements.extra when present', async () => {
    const { default: solanaPlugin } = await import('../../src/plugins/chains/solana')
    const base64 = await solanaPlugin.sign(MOCK_INTENT, mockWallet)
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
    expect(decoded.accepted.extra.feePayer).toBe('L54zkaPQFeTn1UsEqieEXBqWrPShiaZEPD7mS5WXfQg')
  })

  it('payload.transaction is base64-encoded bytes (not btoa)', async () => {
    const { default: solanaPlugin } = await import('../../src/plugins/chains/solana')
    const base64 = await solanaPlugin.sign(MOCK_INTENT, mockWallet)
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
    // Must be valid base64 — Buffer decode should not throw
    expect(() => Buffer.from(decoded.payload.transaction, 'base64')).not.toThrow()
  })
})
