// tests/integration.test.ts
import { describe, it, expect, mock, beforeEach, afterEach, beforeAll, afterAll, spyOn } from 'bun:test'
import { Connection } from '@solana/web3.js'
import { PaymentStatus } from '../src/types'

// Test mnemonic (DO NOT USE IN PRODUCTION)
const TEST_SEED_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const MOCK_BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'

// Fixture data
const MOCK_INTENT_SOLANA = {
  intent_id: '3b154135-4091-4f23-b962-4871d7160dea',
  merchant_recipient: '7F3aWqfBt9MHEF96hz87fvoSE4BaYCwTwHoi19bJBjC8',
  sending_amount: '0.03',
  receiving_amount: '0.02797',
  payer_chain: 'solana',
  status: PaymentStatus.AWAITING_PAYMENT,
  created_at: '2025-12-27T14:58:43Z',
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  fee_breakdown: { platform_fee: '0.00003', platform_fee_percentage: '0.1%', source_chain: 'solana', source_chain_fee: '0.001', target_chain: 'base', target_chain_fee: '0.001', total_fee: '0.002' },
  payment_requirements: {
    scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', amount: '30000',
    payTo: '7F3aWqfBt9MHEF96hz87fvoSE4BaYCwTwHoi19bJBjC8', maxTimeoutSeconds: 599,
    asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    extra: { feePayer: 'L54zkaPQFeTn1UsEqieEXBqWrPShiaZEPD7mS5WXfQg', decimals: 6 },
  },
}

const MOCK_SETTLED_SOLANA = {
  ...MOCK_INTENT_SOLANA,
  status: PaymentStatus.BASE_SETTLED,
  source_payment: { chain: 'solana', tx_hash: 'solana_tx_hash_abc', settle_proof: 'proof', settled_at: '2025-12-27T15:00Z', explorer_url: 'https://solscan.io/tx/solana_tx_hash_abc' },
  base_payment: { chain: 'base', tx_hash: '0xdef456', settle_proof: 'x402_base', settled_at: '2025-12-27T15:00Z', explorer_url: 'https://basescan.org/tx/0xdef456' },
}

// Helper: collect stdout writes
function captureOutput(fn: () => Promise<void>): Promise<string> {
  return new Promise(async (resolve) => {
    let output = ''
    const spy = spyOn(process.stdout, 'write').mockImplementation((data: any) => {
      output += data.toString()
      return true
    })
    await fn()
    spy.mockRestore()
    resolve(output)
  })
}

// Mock Solana RPC for all tests in this file
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

describe('tpay version', () => {
  it('outputs JSON with name and version', async () => {
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['version']))
    const json = JSON.parse(out)
    expect(json.name).toBe('@agent-tech/tpay-cli')
    expect(json.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('tpay help', () => {
  it('outputs JSON with commands list', async () => {
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['help']))
    const json = JSON.parse(out)
    expect(json.commands).toBeTruthy()
    expect(json.commands.send).toBeTruthy()
  })

  it('--help alias works', async () => {
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['--help']))
    const json = JSON.parse(out)
    expect(json.commands).toBeTruthy()
  })
})

describe('tpay send --help', () => {
  it('outputs send command args', async () => {
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--help']))
    const json = JSON.parse(out)
    expect(json.command).toBe('send')
    expect(json.args['--to']).toBeTruthy()
  })
})

describe('tpay send (Solana happy path)', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
    process.env.WALLET_SEED_PHRASE = TEST_SEED_PHRASE
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.WALLET_SEED_PHRASE
  })

  it('outputs success with tx_hash and explorer_url', async () => {
    globalThis.fetch = mock((url: string, opts: any) => {
      if (opts?.method === 'POST' && url.includes('/api/intents') && !url.includes('intent_id')) {
        return Promise.resolve(new Response(JSON.stringify(MOCK_INTENT_SOLANA), { status: 200 }))
      }
      if (opts?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ status: 'PENDING' }), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify(MOCK_SETTLED_SOLANA), { status: 200 }))
    }) as unknown as typeof fetch

    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', 'some_address', '--amount', '0.03']))
    const json = JSON.parse(out)
    expect(json.status).toBe('success')
    expect(json.tx_hash).toBe('solana_tx_hash_abc')
    expect(json.explorer_url).toBeTruthy()
  })
})

describe('tpay send (errors)', () => {
  let originalFetch: typeof fetch
  beforeEach(() => {
    originalFetch = globalThis.fetch
    process.env.WALLET_SEED_PHRASE = TEST_SEED_PHRASE
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.WALLET_SEED_PHRASE
  })

  it('outputs error on VERIFICATION_FAILED', async () => {
    const failed = { ...MOCK_INTENT_SOLANA, status: PaymentStatus.VERIFICATION_FAILED, error_message: 'bad signature' }
    globalThis.fetch = mock((url: string, opts: any) => {
      if (opts?.method === 'POST' && !url.includes('intent_id')) return Promise.resolve(new Response(JSON.stringify(MOCK_INTENT_SOLANA), { status: 200 }))
      if (opts?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ status: 'PENDING' }), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify(failed), { status: 200 }))
    }) as unknown as typeof fetch

    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', 'some_address', '--amount', '0.03']))
    const json = JSON.parse(out)
    expect(json.status).toBe('error')
    expect(json.message).toContain('bad signature')
  })

  it('outputs error on 5xx from create intent', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('', { status: 500 }))) as unknown as typeof fetch
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', 'some_address', '--amount', '0.03']))
    const json = JSON.parse(out)
    expect(json.status).toBe('error')
    expect(json.message).toContain('500')
  })

  it('error message never contains seed phrase', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error(`fetch failed with ${TEST_SEED_PHRASE}`))) as unknown as typeof fetch
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', 'some_address', '--amount', '0.03']))
    expect(out).not.toContain(TEST_SEED_PHRASE)
  })
})

describe('tpay intent status', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('outputs ok with payment_status for BASE_SETTLED', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(MOCK_SETTLED_SOLANA), { status: 200 }))) as unknown as typeof fetch
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['intent', 'status', '3b154135-4091-4f23-b962-4871d7160dea']))
    const json = JSON.parse(out)
    expect(json.status).toBe('ok')
    expect(json.payment_status).toBe('BASE_SETTLED')
    expect(json.tx_hash).toBe('solana_tx_hash_abc')
  })
})

describe('--verbose', () => {
  it('debug output goes to stderr, stdout remains valid JSON', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(MOCK_SETTLED_SOLANA), { status: 200 }))) as unknown as typeof fetch
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['intent', 'status', 'abc', '--verbose']))
    // stdout must be valid JSON regardless of verbose
    expect(() => JSON.parse(out)).not.toThrow()
  })
})
