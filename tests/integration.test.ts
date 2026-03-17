// tests/integration.test.ts
import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test'
import { PaymentStatus } from '../src/types'

// Fixture data
const MOCK_INTENT_EVM = {
  intent_id: '3b154135-4091-4f23-b962-4871d7160dea',
  merchant_recipient: '0xa789...',
  sending_amount: '0.03',
  receiving_amount: '0.02797',
  payer_chain: 'base',
  status: PaymentStatus.AWAITING_PAYMENT,
  created_at: '2025-12-27T14:58:43Z',
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  fee_breakdown: { platform_fee: '0.00003', platform_fee_percentage: '0.1%', source_chain: 'base', source_chain_fee: '0.001', target_chain: 'base', target_chain_fee: '0.001', total_fee: '0.002' },
  payment_requirements: {
    scheme: 'exact', network: 'eip155:8453', amount: '30000',
    payTo: '0x88F2c900e5aF5ae26C372c5997a1D0bf2bfa4b8d', maxTimeoutSeconds: 599,
    asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    extra: { name: 'USD Coin', version: '2' },
  },
}

const MOCK_SETTLED_EVM = {
  ...MOCK_INTENT_EVM,
  status: PaymentStatus.BASE_SETTLED,
  source_payment: { chain: 'base', tx_hash: '0xabc123', settle_proof: 'proof', settled_at: '2025-12-27T15:00Z', explorer_url: 'https://basescan.org/tx/0xabc123' },
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

describe('tpay version', () => {
  it('outputs JSON with name and version', async () => {
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['version']))
    const json = JSON.parse(out)
    expect(json.name).toBe('@agentpay/tpay-cli')
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

describe('tpay send (EVM happy path)', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('outputs success with tx_hash and explorer_url', async () => {
    process.env.WALLET_EVM_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    let callCount = 0
    globalThis.fetch = mock((url: string, opts: any) => {
      if (opts?.method === 'POST' && url.includes('/api/intents') && !url.includes('intent_id')) {
        return Promise.resolve(new Response(JSON.stringify(MOCK_INTENT_EVM), { status: 200 }))
      }
      if (opts?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ status: 'PENDING' }), { status: 200 }))
      }
      // GET poll — return settled on second call
      callCount++
      return Promise.resolve(new Response(JSON.stringify(MOCK_SETTLED_EVM), { status: 200 }))
    }) as unknown as typeof fetch

    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', '0xabc', '--amount', '0.03', '--chain', 'base']))
    const json = JSON.parse(out)
    expect(json.status).toBe('success')
    expect(json.tx_hash).toBe('0xabc123')
    expect(json.explorer_url).toBeTruthy()
  })
})

describe('tpay send (errors)', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('outputs error on VERIFICATION_FAILED', async () => {
    process.env.WALLET_EVM_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    const failed = { ...MOCK_INTENT_EVM, status: PaymentStatus.VERIFICATION_FAILED, error_message: 'bad signature' }
    globalThis.fetch = mock((url: string, opts: any) => {
      if (opts?.method === 'POST' && !url.includes('intent_id')) return Promise.resolve(new Response(JSON.stringify(MOCK_INTENT_EVM), { status: 200 }))
      if (opts?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ status: 'PENDING' }), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify(failed), { status: 200 }))
    }) as unknown as typeof fetch

    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', '0xabc', '--amount', '0.03', '--chain', 'base']))
    const json = JSON.parse(out)
    expect(json.status).toBe('error')
    expect(json.message).toContain('bad signature')
  })

  it('outputs error on 5xx from create intent', async () => {
    process.env.WALLET_EVM_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    globalThis.fetch = mock(() => Promise.resolve(new Response('', { status: 500 }))) as unknown as typeof fetch
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', '0xabc', '--amount', '0.03', '--chain', 'base']))
    const json = JSON.parse(out)
    expect(json.status).toBe('error')
    expect(json.message).toContain('500')
  })

  it('error message never contains private key value', async () => {
    const fakeKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    process.env.WALLET_EVM_PRIVATE_KEY = fakeKey
    globalThis.fetch = mock(() => Promise.reject(new Error(`fetch failed with ${fakeKey}`))) as unknown as typeof fetch
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', '0xabc', '--amount', '0.03', '--chain', 'base']))
    expect(out).not.toContain(fakeKey)
  })
})

describe('tpay intent status', () => {
  let originalFetch: typeof fetch
  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('outputs ok with payment_status for BASE_SETTLED', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(MOCK_SETTLED_EVM), { status: 200 }))) as unknown as typeof fetch
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['intent', 'status', '3b154135-4091-4f23-b962-4871d7160dea']))
    const json = JSON.parse(out)
    expect(json.status).toBe('ok')
    expect(json.payment_status).toBe('BASE_SETTLED')
    expect(json.tx_hash).toBe('0xabc123')
  })
})

describe('--verbose', () => {
  it('debug output goes to stderr, stdout remains valid JSON', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(MOCK_SETTLED_EVM), { status: 200 }))) as unknown as typeof fetch
    process.env.WALLET_EVM_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['intent', 'status', 'abc', '--verbose']))
    // stdout must be valid JSON regardless of verbose
    expect(() => JSON.parse(out)).not.toThrow()
  })
})
