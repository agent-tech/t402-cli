// tests/payment.test.ts
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { PaymentStatus } from '../src/types'
import type { GetPaymentIntentResponse, PaymentIntentResponse } from '../src/types'

// Mock fixture data (from fe-t402-pay/src/modules/paymentFlow/api/mockingData.ts)
const MOCK_INTENT_EVM = {
  intent_id: '3b154135-4091-4f23-b962-4871d7160dea',
  merchant_recipient: '0xa7891083D60C5CAfED30c59b74836BdC77136b48',
  sending_amount: '0.03',
  receiving_amount: '0.02797',
  payer_chain: 'base',
  status: PaymentStatus.AWAITING_PAYMENT,
  created_at: '2025-12-27T14:58:43.313974Z',
  expires_at: new Date(Date.now() + 600_000).toISOString(), // 10 min from now
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

const MOCK_SETTLED_EVM = {
  ...MOCK_INTENT_EVM,
  status: PaymentStatus.BASE_SETTLED,
  source_payment: {
    chain: 'base',
    tx_hash: '0xbb4d1efc4dbf2ea3d31e31144af79962ff2d1cd423b40adbbf10a7dbdefed079',
    settle_proof: 'proof',
    settled_at: '2025-12-27T14:59:46.408893Z',
    explorer_url: 'https://basescan.org/tx/0xbb4d...',
  },
  base_payment: {
    chain: 'base',
    tx_hash: '0x06cdfd87f96f4baf28b0196eb0f8f8c248dbb8c2aaadb5798e56ed47dff1e93b',
    settle_proof: 'x402_base',
    settled_at: '2025-12-27T14:59:47.602532Z',
    explorer_url: 'https://basescan.org/tx/0x06cd...',
  },
}

describe('pollIntent', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('returns success when status is BASE_SETTLED', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(JSON.stringify(MOCK_SETTLED_EVM), { status: 200 })))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as PaymentIntentResponse, 0)
    expect(result.terminal).toBe(true)
    expect(result.success).toBe(true)
  })

  it('returns error on VERIFICATION_FAILED', async () => {
    const failed = { ...MOCK_INTENT_EVM, status: PaymentStatus.VERIFICATION_FAILED, error_message: 'sig invalid' }
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(failed), { status: 200 }))) as unknown as typeof fetch
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as PaymentIntentResponse, 0)
    expect(result.terminal).toBe(true)
    expect(result.success).toBe(false)
    expect(result.message).toContain('sig invalid')
  })

  it('returns error when error_message present', async () => {
    const withMsg = { ...MOCK_INTENT_EVM, status: PaymentStatus.VERIFICATION_FAILED, error_message: 'unexpected error' }
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(withMsg), { status: 200 }))) as unknown as typeof fetch
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as PaymentIntentResponse, 0)
    expect(result.terminal).toBe(true)
    expect(result.success).toBe(false)
  })

  it('returns error on EXPIRED status', async () => {
    const expired = { ...MOCK_INTENT_EVM, status: PaymentStatus.EXPIRED, error_message: 'expired' }
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(expired), { status: 200 }))) as unknown as typeof fetch
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as PaymentIntentResponse, 0)
    expect(result.terminal).toBe(true)
    expect(result.success).toBe(false)
    expect(result.message).toBe('Payment expired')
  })

  it('returns non-terminal for PENDING status', async () => {
    const pending = { ...MOCK_INTENT_EVM, status: PaymentStatus.PENDING }
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(pending), { status: 200 }))) as unknown as typeof fetch
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as PaymentIntentResponse, 0)
    expect(result.terminal).toBe(false)
  })

  it('skips tick on poll timeout (non-terminal)', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('AbortError'))) as unknown as typeof fetch
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as PaymentIntentResponse, 0)
    expect(result.terminal).toBe(false)
  })

  it('skips tick on 5xx poll response (non-terminal)', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('', { status: 503 }))) as unknown as typeof fetch
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as PaymentIntentResponse, 0)
    expect(result.terminal).toBe(false)
  })
})

describe('expires_at deadline', () => {
  it('stops polling when past expires_at', async () => {
    const expiredIntent = { ...MOCK_INTENT_EVM, expires_at: new Date(Date.now() - 1000).toISOString() }
    const { checkExpired } = await import('../src/payment')
    expect(checkExpired(expiredIntent as PaymentIntentResponse)).toBe(true)
  })

  it('continues polling when before expires_at', async () => {
    const { checkExpired } = await import('../src/payment')
    expect(checkExpired(MOCK_INTENT_EVM as PaymentIntentResponse)).toBe(false)
  })
})
