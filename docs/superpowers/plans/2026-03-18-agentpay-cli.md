# agentpay-cli Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript CLI (`tpay`) that AI agents call to send USDC/USDT via the T402 x402 v2 payment protocol, supporting EVM (Base, BSC) and Solana chains.

**Architecture:** Three-layer plugin architecture — a CLI entry point dispatches to a `PaymentClient` (T402 API), a `ChainPlugin` (per-chain signing), and a `WalletPlugin` (key management). Plugins are statically imported so `bun build --compile` can bundle them. All stdout is structured JSON; all logs go to stderr.

**Tech Stack:** Bun, TypeScript, `@tetherto/wdk-wallet-evm`, `@tetherto/wdk-wallet-solana`, `@solana/web3.js`, Bun macros for build-time config, `bun test` for testing.

---

## File Map

| File | Responsibility |
|---|---|
| `src/types.ts` | Shared types: `PaymentStatus`, `PaymentIntentResponse`, `GetPaymentIntentResponse`, etc. |
| `src/logger.ts` | `log()`, `debug()` → stderr; `sanitizeError()`; verbose flag |
| `src/macros/config.macro.ts` | Build-time: embed `apiUrl`, `solana.rpcUrl`, `solana.feePayer` |
| `src/macros/version.macro.ts` | Build-time: embed `name` and `version` from `package.json` |
| `src/plugins/wallets/types.ts` | `WalletPlugin` interface |
| `src/plugins/wallets/env.ts` | Reads `WALLET_EVM_PRIVATE_KEY` and `WALLET_SOLANA_SEED` from env |
| `src/plugins/chains/types.ts` | `ChainPlugin` interface |
| `src/plugins/chains/evm.ts` | EIP-712 `TransferWithAuthorization` for Base/BSC/Base-Sepolia |
| `src/plugins/chains/solana.ts` | SPL `TransferChecked` x402 v2 VersionedTransaction for Solana |
| `src/loader.ts` | Static map of wallet + chain plugins; resolves by name/payer_chain |
| `src/payment.ts` | `createIntent()`, `submitProof()`, `pollIntent()`, `getIntentStatus()` |
| `src/index.ts` | CLI entry: parse args/stdin, dispatch to commands; send/intent status/version/help |
| `tests/logger.test.ts` | Unit: `sanitizeError` security guarantees |
| `tests/loader.test.ts` | Unit: plugin resolution |
| `tests/payment.test.ts` | Unit: polling stop conditions, timeout/5xx handling |
| `tests/chains/evm.test.ts` | Unit: EVM payload structure and domain construction |
| `tests/chains/solana.test.ts` | Unit: Solana payload structure, `accepted.extra` is `{feePayer}` only |
| `tests/integration.test.ts` | Integration: full send flow and intent status with mocked fetch |
| `README.md` | Usage, build instructions, env vars, extension checklists |

---

## Task 1: Project Setup

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `src/` directory tree (empty files to establish structure)

- [ ] **Step 1: Install dependencies**

```bash
cd H:/project/outsourcing/agentpay-cli
bun add @tetherto/wdk-wallet-evm @tetherto/wdk-wallet-solana @solana/web3.js
bun add -d typescript @types/node
```

- [ ] **Step 2: Update `package.json`**

Replace contents of `package.json`:

```json
{
  "name": "@agentpay/tpay-cli",
  "version": "0.0.1",
  "description": "T402 CLI for agent automation",
  "main": "src/index.ts",
  "bin": {
    "tpay": "src/index.ts"
  },
  "scripts": {
    "dev": "bun run src/index.ts",
    "build": "bun build --compile src/index.ts --outfile tpay",
    "test": "bun test",
    "test:watch": "bun test --watch"
  },
  "author": "TianyiLi",
  "license": "ISC",
  "private": true,
  "dependencies": {
    "@tetherto/wdk-wallet-evm": "1.0.0-beta.8",
    "@tetherto/wdk-wallet-solana": "1.0.0-beta.5",
    "@solana/web3.js": "^1.98.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/node": "latest",
    "typescript": "^5"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Create directory tree**

```bash
mkdir -p src/macros src/plugins/wallets src/plugins/chains tests/chains
touch src/types.ts src/logger.ts src/loader.ts src/payment.ts src/index.ts
touch src/macros/config.macro.ts src/macros/version.macro.ts
touch src/plugins/wallets/types.ts src/plugins/wallets/env.ts
touch src/plugins/chains/types.ts src/plugins/chains/evm.ts src/plugins/chains/solana.ts
touch tests/logger.test.ts tests/loader.test.ts tests/payment.test.ts
touch tests/chains/evm.test.ts tests/chains/solana.test.ts tests/integration.test.ts
```

- [ ] **Step 5: Verify Bun test runs**

```bash
bun test
```

Expected: all test files found, 0 tests pass (empty files).

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "feat: project setup — deps, tsconfig, directory structure"
```

---

## Task 2: Shared Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```typescript
export enum PaymentStatus {
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PENDING = 'PENDING',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  SOURCE_SETTLED = 'SOURCE_SETTLED',
  BASE_SETTLING = 'BASE_SETTLING',
  BASE_SETTLED = 'BASE_SETTLED',
  EXPIRED = 'EXPIRED',
}

export interface FeeBreakdown {
  platform_fee: string
  platform_fee_percentage: string
  source_chain: string
  source_chain_fee: string
  target_chain: string
  target_chain_fee: string
  total_fee: string
}

export interface PaymentRequirements {
  scheme: string
  network: string
  amount: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  extra: {
    name?: string
    version?: string
    feePayer?: string
    decimals?: number
    [key: string]: unknown
  }
}

export interface PaymentIntentResponse {
  intent_id: string
  merchant_recipient: string
  source_recipient?: string
  sending_amount: string
  receiving_amount: string
  payer_chain: string
  status: PaymentStatus
  created_at: string
  expires_at: string
  fee_breakdown: FeeBreakdown
  payment_requirements: PaymentRequirements
}

export interface SourcePayment {
  chain: string
  tx_hash: string
  settle_proof: string
  settled_at: string
  explorer_url: string
}

export type GetPaymentIntentBaseSettledResponse = PaymentIntentResponse & {
  status: PaymentStatus.BASE_SETTLED
  source_payment: SourcePayment
  base_payment: SourcePayment
}

export type GetPaymentIntentFailedResponse = PaymentIntentResponse & {
  status: PaymentStatus.VERIFICATION_FAILED | PaymentStatus.EXPIRED
  error_message: string
}

export type GetPaymentIntentResponse =
  | PaymentIntentResponse
  | GetPaymentIntentBaseSettledResponse
  | GetPaymentIntentFailedResponse

export interface SendInput {
  to: string
  amount: string
  chain: string
  walletProvider?: string
}

export interface CliOutput {
  status: 'success' | 'error' | 'ok'
  [key: string]: unknown
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run --bun tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared types mirroring T402 PaymentFlow types"
```

---

## Task 3: Logger and sanitizeError

**Files:**
- Create: `src/logger.ts`
- Test: `tests/logger.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/logger.test.ts
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test'
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

  it('never exposes private key values', () => {
    const fakeKey = '0xdeadbeefdeadbeefdeadbeef'
    const err = new Error(`failed with key ${fakeKey}`)
    // sanitizeError only returns message — caller must not pass key into message
    // this test ensures object spread is blocked
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/logger.test.ts
```

Expected: FAIL — `sanitizeError` and `createLogger` not defined.

- [ ] **Step 3: Implement `src/logger.ts`**

```typescript
export function sanitizeError(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    if ('message' in e && typeof (e as any).message === 'string') {
      return (e as any).message
    }
  }
  return 'Unknown error'
}

export interface Logger {
  log(message: string, data?: unknown): void
  debug(message: string, data?: unknown): void
}

export function createLogger(verbose: boolean): Logger {
  function write(prefix: string, message: string, data?: unknown) {
    const line = data !== undefined
      ? `[${prefix}] ${message} ${JSON.stringify(data)}\n`
      : `[${prefix}] ${message}\n`
    process.stderr.write(line)
  }

  return {
    log(message, data) {
      write('info', message, data)
    },
    debug(message, data) {
      if (verbose) write('debug', message, data)
    },
  }
}

// Default singleton — replaced in index.ts after parsing --verbose
export let logger: Logger = createLogger(false)
export function setLogger(l: Logger) { logger = l }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/logger.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/logger.ts tests/logger.test.ts
git commit -m "feat: add logger with sanitizeError — logs to stderr, respects --verbose"
```

---

## Task 4: Bun Macros

**Files:**
- Create: `src/macros/config.macro.ts`
- Create: `src/macros/version.macro.ts`

> Bun macros run at `bun build` time. At `bun run` (dev mode), they execute normally as functions. No tests needed — verified during build in Task 9.

- [ ] **Step 1: Write `src/macros/config.macro.ts`**

```typescript
// This file is imported with { type: 'macro' } — runs at bun build time.
// At dev time (bun run), it runs as a normal function reading process.env.
export function getConfig() {
  return {
    apiUrl: process.env.T402_API_URL ?? '',
    solana: {
      rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
      feePayer: process.env.SOLANA_FEE_PAYER ?? '',
    },
  }
}
```

- [ ] **Step 2: Write `src/macros/version.macro.ts`**

```typescript
import pkg from '../../package.json'

export function getVersion() {
  return {
    name: pkg.name as string,
    version: pkg.version as string,
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/macros/
git commit -m "feat: add Bun macros for build-time config and version embedding"
```

---

## Task 5: Plugin Interfaces + Env Wallet Plugin + Loader

**Files:**
- Create: `src/plugins/wallets/types.ts`
- Create: `src/plugins/chains/types.ts`
- Create: `src/plugins/wallets/env.ts`
- Create: `src/loader.ts`
- Test: `tests/loader.test.ts`

- [ ] **Step 1: Write failing loader tests**

```typescript
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
```

- [ ] **Step 2: Run to verify they fail**

```bash
bun test tests/loader.test.ts
```

Expected: FAIL — modules not implemented.

- [ ] **Step 3: Write `src/plugins/wallets/types.ts`**

```typescript
export interface WalletPlugin {
  name: string
  getEvmPrivateKey(): string     // hex private key (0x...)
  getSolanaSeed(): Uint8Array    // 64-byte seed
}
```

- [ ] **Step 4: Write `src/plugins/chains/types.ts`**

```typescript
import type { PaymentIntentResponse } from '../../types'
import type { WalletPlugin } from '../wallets/types'

export interface ChainPlugin {
  name: string
  chains: string[]
  sign(intent: PaymentIntentResponse, wallet: WalletPlugin): Promise<string>
  // returns base64-encoded x402 v2 payload string
}
```

- [ ] **Step 5: Write `src/plugins/wallets/env.ts`**

```typescript
import type { WalletPlugin } from './types'

const plugin: WalletPlugin = {
  name: 'env',

  getEvmPrivateKey(): string {
    const key = process.env.WALLET_EVM_PRIVATE_KEY
    if (!key) throw new Error('WALLET_EVM_PRIVATE_KEY env var is not set')
    return key
  },

  getSolanaSeed(): Uint8Array {
    const hex = process.env.WALLET_SOLANA_SEED
    if (!hex) throw new Error('WALLET_SOLANA_SEED env var is not set')
    const bytes = Buffer.from(hex, 'hex')
    if (bytes.length !== 64) throw new Error('WALLET_SOLANA_SEED must be a 64-byte hex string')
    return new Uint8Array(bytes)
  },
}

export default plugin
```

- [ ] **Step 6: Write `src/loader.ts`**

```typescript
import type { WalletPlugin } from './plugins/wallets/types'
import type { ChainPlugin } from './plugins/chains/types'

// Static map — Bun's --compile can trace these imports at build time
const WALLET_PLUGINS: Record<string, () => Promise<WalletPlugin>> = {
  env: () => import('./plugins/wallets/env').then(m => m.default),
}

const CHAIN_PLUGIN_LOADERS: Array<() => Promise<ChainPlugin>> = [
  () => import('./plugins/chains/evm').then(m => m.default),
  () => import('./plugins/chains/solana').then(m => m.default),
]

export async function resolveWalletPlugin(): Promise<WalletPlugin> {
  const provider = process.env.WALLET_PROVIDER ?? 'env'
  const loader = WALLET_PLUGINS[provider]
  if (!loader) throw new Error(`Unknown wallet provider: "${provider}". Available: ${Object.keys(WALLET_PLUGINS).join(', ')}`)
  return loader()
}

export async function resolveChainPlugin(payerChain: string): Promise<ChainPlugin> {
  const plugins = await Promise.all(CHAIN_PLUGIN_LOADERS.map(l => l()))
  const plugin = plugins.find(p => p.chains.includes(payerChain))
  if (!plugin) throw new Error(`No chain plugin found for payer_chain: "${payerChain}"`)
  return plugin
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
bun test tests/loader.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/plugins/ src/loader.ts tests/loader.test.ts
git commit -m "feat: plugin interfaces, env wallet plugin, and loader"
```

---

## Task 6: T402 Payment Client

**Files:**
- Create: `src/payment.ts`
- Test: `tests/payment.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/payment.test.ts
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { PaymentStatus } from '../src/types'
import type { GetPaymentIntentResponse } from '../src/types'

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
  it('returns success when status is BASE_SETTLED', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(JSON.stringify(MOCK_SETTLED_EVM), { status: 200 })))
    globalThis.fetch = fetchMock as any
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as any, 0)
    expect(result.terminal).toBe(true)
    expect(result.success).toBe(true)
  })

  it('returns error on VERIFICATION_FAILED', async () => {
    const failed = { ...MOCK_INTENT_EVM, status: PaymentStatus.VERIFICATION_FAILED, error_message: 'sig invalid' }
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(failed), { status: 200 }))) as any
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as any, 0)
    expect(result.terminal).toBe(true)
    expect(result.success).toBe(false)
    expect(result.message).toContain('sig invalid')
  })

  it('returns error when error_message present', async () => {
    const withMsg = { ...MOCK_INTENT_EVM, error_message: 'unexpected error' }
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(withMsg), { status: 200 }))) as any
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as any, 0)
    expect(result.terminal).toBe(true)
    expect(result.success).toBe(false)
  })

  it('returns error on EXPIRED status', async () => {
    const expired = { ...MOCK_INTENT_EVM, status: PaymentStatus.EXPIRED, error_message: 'expired' }
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(expired), { status: 200 }))) as any
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as any, 0)
    expect(result.terminal).toBe(true)
    expect(result.success).toBe(false)
    expect(result.message).toBe('Payment expired')
  })

  it('returns non-terminal for PENDING status', async () => {
    const pending = { ...MOCK_INTENT_EVM, status: PaymentStatus.PENDING }
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(pending), { status: 200 }))) as any
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as any, 0)
    expect(result.terminal).toBe(false)
  })

  it('skips tick on poll timeout (non-terminal)', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('AbortError'))) as any
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as any, 0)
    expect(result.terminal).toBe(false)
  })

  it('skips tick on 5xx poll response (non-terminal)', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response('', { status: 503 }))) as any
    const { pollIntent } = await import('../src/payment')
    const result = await pollIntent('http://api', MOCK_INTENT_EVM as any, 0)
    expect(result.terminal).toBe(false)
  })
})

describe('expires_at deadline', () => {
  it('stops polling when past expires_at', async () => {
    const expiredIntent = { ...MOCK_INTENT_EVM, expires_at: new Date(Date.now() - 1000).toISOString() }
    const { checkExpired } = await import('../src/payment')
    expect(checkExpired(expiredIntent as any)).toBe(true)
  })

  it('continues polling when before expires_at', async () => {
    const { checkExpired } = await import('../src/payment')
    expect(checkExpired(MOCK_INTENT_EVM as any)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
bun test tests/payment.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/payment.ts`**

```typescript
import type { PaymentIntentResponse, GetPaymentIntentResponse, SendInput } from './types'
import { PaymentStatus } from './types'

const REQUEST_TIMEOUT_MS = 30_000

export interface PollResult {
  terminal: boolean
  success: boolean
  data?: GetPaymentIntentResponse
  message?: string
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

export async function createIntent(apiUrl: string, input: SendInput): Promise<PaymentIntentResponse> {
  const body: Record<string, string> = {
    amount: input.amount,
    payer_chain: input.chain,
  }
  // recipient can be email or wallet address
  if (input.to.includes('@')) {
    body.email = input.to
  } else {
    body.recipient = input.to
  }

  const res = await fetch(`${apiUrl}/api/intents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: withTimeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`)
  }
  return res.json() as Promise<PaymentIntentResponse>
}

export async function submitProof(apiUrl: string, intentId: string, settleProof: string): Promise<void> {
  const res = await fetch(`${apiUrl}/api/intents/${intentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settle_proof: settleProof }),
    signal: withTimeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`)
  }
  // Response is PENDING — ignore it, proceed to polling
}

export function checkExpired(intent: PaymentIntentResponse): boolean {
  return Date.now() > Date.parse(intent.expires_at)
}

export async function pollIntent(
  apiUrl: string,
  intent: PaymentIntentResponse,
  intervalMs: number,
): Promise<PollResult> {
  if (checkExpired(intent)) {
    return { terminal: true, success: false, message: 'Payment expired' }
  }

  try {
    const res = await fetch(`${apiUrl}/api/intents?intent_id=${intent.intent_id}`, {
      signal: withTimeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      // 5xx or other: skip this tick, retry next interval
      return { terminal: false, success: false }
    }

    const data = await res.json() as GetPaymentIntentResponse & { error_message?: string }

    if (data.status === PaymentStatus.BASE_SETTLED) {
      return { terminal: true, success: true, data }
    }
    if (data.status === PaymentStatus.EXPIRED) {
      return { terminal: true, success: false, message: 'Payment expired' }
    }
    if (
      data.status === PaymentStatus.VERIFICATION_FAILED ||
      data.error_message
    ) {
      return {
        terminal: true,
        success: false,
        message: `Verification failed: ${data.error_message ?? 'unknown'}`,
      }
    }

    // PENDING, AWAITING_PAYMENT, SOURCE_SETTLED, BASE_SETTLING — continue
    return { terminal: false, success: false }
  } catch {
    // Timeout or network error on GET poll — skip tick, retry
    return { terminal: false, success: false }
  }
}

export async function getIntentStatus(
  apiUrl: string,
  intentId: string,
): Promise<GetPaymentIntentResponse> {
  const res = await fetch(`${apiUrl}/api/intents?intent_id=${intentId}`, {
    signal: withTimeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`)
  }
  return res.json() as Promise<GetPaymentIntentResponse>
}

export async function runPayment(
  apiUrl: string,
  intent: PaymentIntentResponse,
  settleProof: string,
  pollIntervalMs = 2000,
): Promise<PollResult> {
  await submitProof(apiUrl, intent.intent_id, settleProof)

  while (true) {
    if (pollIntervalMs > 0) {
      await new Promise(r => setTimeout(r, pollIntervalMs))
    }
    const result = await pollIntent(apiUrl, intent, 0)
    if (result.terminal) return result
    if (checkExpired(intent)) {
      return { terminal: true, success: false, message: 'Payment expired' }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/payment.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/payment.ts tests/payment.test.ts
git commit -m "feat: T402 payment client with polling, timeout, and expiry logic"
```

---

## Task 7: EVM Chain Plugin

**Files:**
- Create: `src/plugins/chains/evm.ts`
- Test: `tests/chains/evm.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
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
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const mockWallet = {
  name: 'test',
  getEvmPrivateKey: () => TEST_PRIVATE_KEY,
  getSolanaSeed: () => new Uint8Array(64),
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
        asset: '0xcustom_asset_address',
        extra: { name: 'Custom Token', version: '3' },
      },
    }
    const base64 = await evmPlugin.sign(customIntent, mockWallet)
    const decoded = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
    expect(decoded.accepted.asset).toBe('0xcustom_asset_address')
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
```

- [ ] **Step 2: Run to verify they fail**

```bash
bun test tests/chains/evm.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/plugins/chains/evm.ts`**

```typescript
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import type { ChainPlugin } from './types'
import type { PaymentIntentResponse } from '../../types'
import type { WalletPlugin } from '../wallets/types'

function parseChainId(network: string): number {
  // network is CAIP-2 format: 'eip155:8453'
  const parts = network.split(':')
  const id = parseInt(parts[1], 10)
  if (isNaN(id)) throw new Error(`Cannot parse chainId from network: ${network}`)
  return id
}

const evmPlugin: ChainPlugin = {
  name: 'evm',
  chains: ['base', 'bsc', 'base-sepolia'],

  async sign(intent: PaymentIntentResponse, wallet: WalletPlugin): Promise<string> {
    const asset = intent.payment_requirements.asset
    if (!asset) throw new Error('payment_requirements.asset missing from intent')

    const chainId = parseChainId(intent.payment_requirements.network)
    const privateKey = wallet.getEvmPrivateKey()

    // Use WDK to derive the account and get the address
    const manager = new WalletManagerEvm(privateKey, {})
    const account = await manager.getAccount(0)
    const walletAddress = await account.getAddress()

    const now = Math.floor(Date.now() / 1000)
    const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
    const nonce = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')

    const domain = {
      name: intent.payment_requirements.extra.name as string,
      version: intent.payment_requirements.extra.version as string,
      chainId,
      verifyingContract: asset,
    }

    const types = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    }

    const message = {
      from: walletAddress,
      to: intent.payment_requirements.payTo,
      value: intent.payment_requirements.amount,
      validAfter: String(now - 600),
      validBefore: String(now + 600),
      nonce,
    }

    const signature = await account.signTypedData({ domain, types, primaryType: 'TransferWithAuthorization', message })
    account.dispose()
    manager.dispose()

    const payload = {
      x402Version: 2,
      resource: {
        url: `/api/intents/${intent.intent_id}`,
        description: `Payment of ${intent.sending_amount}`,
        mimeType: 'application/json',
      },
      accepted: {
        scheme: intent.payment_requirements.scheme,
        network: intent.payment_requirements.network,
        amount: intent.payment_requirements.amount,
        asset,
        payTo: intent.payment_requirements.payTo,
        maxTimeoutSeconds: intent.payment_requirements.maxTimeoutSeconds,
        extra: intent.payment_requirements.extra,
      },
      payload: {
        signature,
        authorization: {
          from: walletAddress,
          to: intent.payment_requirements.payTo,
          value: intent.payment_requirements.amount,
          validAfter: message.validAfter,
          validBefore: message.validBefore,
          nonce,
        },
      },
    }

    return Buffer.from(JSON.stringify(payload)).toString('base64')
  },
}

export default evmPlugin
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/chains/evm.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/chains/evm.ts tests/chains/evm.test.ts
git commit -m "feat: EVM chain plugin — EIP-712 TransferWithAuthorization x402 v2 payload"
```

---

## Task 8: Solana Chain Plugin

**Files:**
- Create: `src/plugins/chains/solana.ts`
- Test: `tests/chains/solana.test.ts`

> **Note:** `WalletManagerSolana` from `@tetherto/wdk-wallet-solana` requires `rpcUrl` for `getLatestBlockhash`. The `signTransaction` API on the WDK Solana account may sign without broadcasting — verify against the WDK source. If `signTransaction` is not available as a standalone, access the account's keypair to sign using `@solana/web3.js`'s `VersionedTransaction.sign()`.

- [ ] **Step 1: Write failing tests**

```typescript
// tests/chains/solana.test.ts
import { describe, it, expect, mock } from 'bun:test'
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
```

- [ ] **Step 2: Run to verify they fail**

```bash
bun test tests/chains/solana.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/plugins/chains/solana.ts`**

```typescript
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import type { ChainPlugin } from './types'
import type { PaymentIntentResponse } from '../../types'
import type { WalletPlugin } from '../wallets/types'
import { getConfig } from '../../macros/config.macro'

const CONFIG = getConfig()

function getAssociatedTokenAddress(wallet: PublicKey, mint: PublicKey): PublicKey {
  const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
  const [ata] = PublicKey.findProgramAddressSync(
    [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
  return ata
}

function createSetComputeUnitLimitInstruction(units: number): TransactionInstruction {
  const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111')
  const data = new Uint8Array(5)
  data[0] = 2
  new DataView(data.buffer).setUint32(1, units, true)
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM_ID, data: Buffer.from(data) })
}

function createSetComputeUnitPriceInstruction(microLamports: number): TransactionInstruction {
  const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111')
  const data = new Uint8Array(9)
  data[0] = 3
  new DataView(data.buffer).setBigUint64(1, BigInt(microLamports), true)
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM_ID, data: Buffer.from(data) })
}

function createTransferCheckedInstruction(
  sourceAta: PublicKey,
  mint: PublicKey,
  destAta: PublicKey,
  owner: PublicKey,
  amount: number,
  decimals: number,
): TransactionInstruction {
  const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
  const keys = [
    { pubkey: sourceAta, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: destAta, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false },
  ]
  const data = new Uint8Array(10)
  data[0] = 12
  new DataView(data.buffer).setBigUint64(1, BigInt(amount), true)
  data[9] = decimals
  return new TransactionInstruction({ keys, programId: TOKEN_PROGRAM_ID, data: Buffer.from(data) })
}

const solanaPlugin: ChainPlugin = {
  name: 'solana',
  chains: ['solana', 'solana-devnet'],

  async sign(intent: PaymentIntentResponse, wallet: WalletPlugin): Promise<string> {
    const reqs = intent.payment_requirements
    const asset = reqs.asset
    if (!asset) throw new Error('payment_requirements.asset missing from intent')

    const feePayer = reqs.extra.feePayer ?? CONFIG.solana.feePayer
    if (!feePayer) throw new Error('No feePayer available — set SOLANA_FEE_PAYER at build time or ensure backend provides extra.feePayer')

    const decimals = (reqs.extra.decimals as number | undefined) ?? 6
    const amountAtomic = parseInt(reqs.amount, 10)
    const networkCAIP2 = reqs.network
    const rpcUrl = CONFIG.solana.rpcUrl

    // Derive keypair from seed using WDK
    const manager = new WalletManagerSolana(wallet.getSolanaSeed(), { rpcUrl })
    const account = await manager.getAccount(0)
    const walletAddress = await account.getAddress()

    const connection = new Connection(rpcUrl, 'confirmed')
    const { blockhash } = await connection.getLatestBlockhash('confirmed')

    const mint = new PublicKey(asset)
    const payerPubkey = new PublicKey(walletAddress)
    const recipientPubkey = new PublicKey(reqs.payTo)
    const feePayerPubkey = new PublicKey(feePayer)

    const payerAta = getAssociatedTokenAddress(payerPubkey, mint)
    const recipientAta = getAssociatedTokenAddress(recipientPubkey, mint)

    // x402 spec: exactly 3 instructions in this order
    const instructions = [
      createSetComputeUnitLimitInstruction(200_000),
      createSetComputeUnitPriceInstruction(1),
      createTransferCheckedInstruction(payerAta, mint, recipientAta, payerPubkey, amountAtomic, decimals),
    ]

    const messageV0 = new TransactionMessage({
      payerKey: feePayerPubkey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message()

    const tx = new VersionedTransaction(messageV0)

    // Sign the transaction using the WDK account's keypair
    // WDK Solana account exposes signTransaction — sign without broadcasting
    // If signTransaction is not available, use account.keyPair to sign directly:
    //   tx.sign([account.keyPair])
    const signedTx = await (account as any).signTransaction(tx)
    const serialized: Uint8Array = signedTx instanceof VersionedTransaction
      ? signedTx.serialize()
      : tx.serialize()

    account.dispose?.()
    manager.dispose?.()

    const transactionBase64 = Buffer.from(serialized).toString('base64')

    const payload = {
      x402Version: 2,
      resource: {
        url: `/api/intents/${intent.intent_id}`,
        description: `Payment of ${intent.sending_amount}`,
        mimeType: 'application/json',
      },
      accepted: {
        scheme: reqs.scheme,
        network: networkCAIP2,
        amount: reqs.amount,
        asset,
        payTo: reqs.payTo,
        maxTimeoutSeconds: reqs.maxTimeoutSeconds,
        extra: { feePayer }, // strip to feePayer ONLY
      },
      payload: { transaction: transactionBase64 },
    }

    return Buffer.from(JSON.stringify(payload)).toString('base64')
  },
}

export default solanaPlugin
```

> **Implementation note:** If `account.signTransaction()` does not exist on the WDK Solana account, replace with `tx.sign([account.keyPair])` — the `keyPair` property contains a `secretKey` Uint8Array compatible with `@solana/web3.js`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/chains/solana.test.ts
```

Expected: all pass. (Tests mock the RPC blockhash call if needed via `mock()`.)

- [ ] **Step 5: Commit**

```bash
git add src/plugins/chains/solana.ts tests/chains/solana.test.ts
git commit -m "feat: Solana chain plugin — SPL TransferChecked x402 v2 VersionedTransaction"
```

---

## Task 9: CLI Entry Point

**Files:**
- Create: `src/index.ts`
- Test: `tests/integration.test.ts`

- [ ] **Step 1: Write failing integration tests**

```typescript
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
    payTo: '0x88F2...', maxTimeoutSeconds: 599,
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
    }) as any

    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', '0xabc', '--amount', '0.03', '--chain', 'base']))
    const json = JSON.parse(out)
    expect(json.status).toBe('success')
    expect(json.tx_hash).toBe('0xabc123')
    expect(json.explorer_url).toBeTruthy()
  })
})

describe('tpay send (errors)', () => {
  it('outputs error on VERIFICATION_FAILED', async () => {
    process.env.WALLET_EVM_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    const failed = { ...MOCK_INTENT_EVM, status: PaymentStatus.VERIFICATION_FAILED, error_message: 'bad signature' }
    globalThis.fetch = mock((url: string, opts: any) => {
      if (opts?.method === 'POST' && !url.includes('intent_id')) return Promise.resolve(new Response(JSON.stringify(MOCK_INTENT_EVM), { status: 200 }))
      if (opts?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ status: 'PENDING' }), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify(failed), { status: 200 }))
    }) as any

    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', '0xabc', '--amount', '0.03', '--chain', 'base']))
    const json = JSON.parse(out)
    expect(json.status).toBe('error')
    expect(json.message).toContain('bad signature')
  })

  it('outputs error on 5xx from create intent', async () => {
    process.env.WALLET_EVM_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    globalThis.fetch = mock(() => Promise.resolve(new Response('', { status: 500 }))) as any
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', '0xabc', '--amount', '0.03', '--chain', 'base']))
    const json = JSON.parse(out)
    expect(json.status).toBe('error')
    expect(json.message).toContain('500')
  })

  it('error message never contains private key value', async () => {
    const fakeKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    process.env.WALLET_EVM_PRIVATE_KEY = fakeKey
    globalThis.fetch = mock(() => Promise.reject(new Error(`fetch failed with ${fakeKey}`))) as any
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['send', '--to', '0xabc', '--amount', '0.03', '--chain', 'base']))
    expect(out).not.toContain(fakeKey)
  })
})

describe('tpay intent status', () => {
  it('outputs ok with payment_status for BASE_SETTLED', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(MOCK_SETTLED_EVM), { status: 200 }))) as any
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
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(MOCK_SETTLED_EVM), { status: 200 }))) as any
    process.env.WALLET_EVM_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    const { runCli } = await import('../src/index')
    const out = await captureOutput(() => runCli(['intent', 'status', 'abc', '--verbose']))
    // stdout must be valid JSON regardless of verbose
    expect(() => JSON.parse(out)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

```bash
bun test tests/integration.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `src/index.ts`**

```typescript
import { createLogger, setLogger, sanitizeError } from './logger'
import { resolveWalletPlugin, resolveChainPlugin } from './loader'
import { createIntent, runPayment, getIntentStatus } from './payment'
import { getConfig } from './macros/config.macro'
import { getVersion } from './macros/version.macro'
import type { GetPaymentIntentBaseSettledResponse } from './types'
import { PaymentStatus } from './types'

const CONFIG = getConfig()
const VERSION = getVersion()

function output(data: unknown): void {
  process.stdout.write(JSON.stringify(data) + '\n')
}

function parseArgs(argv: string[]): { args: Record<string, string>; flags: Set<string>; positional: string[] } {
  const args: Record<string, string> = {}
  const flags = new Set<string>()
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args[arg] = next
        i++
      } else {
        flags.add(arg)
      }
    } else {
      positional.push(arg)
    }
  }
  return { args, flags, positional }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data.trim()))
    setTimeout(() => resolve(''), 100) // fallback if no stdin
  })
}

export async function runCli(argv: string[]): Promise<void> {
  const { args, flags, positional } = parseArgs(argv)
  const verbose = flags.has('--verbose')
  const logger = createLogger(verbose)
  setLogger(logger)

  const [command, ...rest] = positional

  try {
    // Help commands
    if (!command || command === 'help' || flags.has('--help')) {
      output({
        commands: {
          'send': 'Send USDC/USDT via T402. Args: --to, --amount, --chain, [--wallet-provider]',
          'intent status <intent_id>': 'Fetch current status of a payment intent',
          'version': 'Print CLI version',
          'help': 'Show this help',
        },
        global_flags: {
          '--verbose': 'Enable debug logging to stderr',
        },
      })
      return
    }

    if (command === 'version') {
      output(VERSION)
      return
    }

    if (command === 'send') {
      if (flags.has('--help')) {
        output({
          command: 'send',
          description: 'Send USDC/USDT via T402 x402 protocol',
          args: {
            '--to': 'Recipient wallet address or email (required)',
            '--amount': 'Amount to send, e.g. "10" (required)',
            '--chain': 'Chain ID: base | bsc | base-sepolia | solana | solana-devnet (required)',
            '--wallet-provider': 'Wallet plugin name, default: env',
          },
          stdin: 'Accepts JSON: {"to": "...", "amount": "...", "chain": "..."}',
        })
        return
      }

      // Parse input from args or stdin
      let to = args['--to']
      let amount = args['--amount']
      let chain = args['--chain']
      const walletProvider = args['--wallet-provider']

      if (!to || !amount || !chain) {
        // Try stdin
        const stdinData = await readStdin()
        if (stdinData) {
          const parsed = JSON.parse(stdinData)
          to = to || parsed.to
          amount = amount || parsed.amount
          chain = chain || parsed.chain
        }
      }

      if (!to || !amount || !chain) {
        output({ status: 'error', message: 'Missing required args: --to, --amount, --chain' })
        process.exitCode = 1
        return
      }

      if (walletProvider) process.env.WALLET_PROVIDER = walletProvider

      logger.debug('Resolving plugins', { chain, walletProvider })
      const walletPlugin = await resolveWalletPlugin()

      logger.debug('Creating payment intent', { to, amount, chain })
      const intent = await createIntent(CONFIG.apiUrl, { to, amount, chain })
      logger.debug('Intent created', { intent_id: intent.intent_id })

      const chainPlugin = await resolveChainPlugin(intent.payer_chain)
      logger.debug('Signing intent', { chain: intent.payer_chain })
      const settleProof = await chainPlugin.sign(intent, walletPlugin)
      logger.debug('Signed, submitting proof')

      const result = await runPayment(CONFIG.apiUrl, intent, settleProof)

      if (result.success && result.data) {
        const settled = result.data as GetPaymentIntentBaseSettledResponse
        output({
          status: 'success',
          intent_id: intent.intent_id,
          tx_hash: settled.source_payment?.tx_hash,
          explorer_url: settled.source_payment?.explorer_url,
        })
      } else {
        output({ status: 'error', message: result.message ?? 'Payment failed' })
        process.exitCode = 1
      }
      return
    }

    if (command === 'intent' && rest[0] === 'status') {
      let intentId = rest[1]

      if (!intentId) {
        const stdinData = await readStdin()
        if (stdinData) {
          const parsed = JSON.parse(stdinData)
          intentId = parsed.intent_id
        }
      }

      if (!intentId) {
        output({ status: 'error', message: 'Missing intent_id' })
        process.exitCode = 1
        return
      }

      logger.debug('Fetching intent status', { intentId })
      const data = await getIntentStatus(CONFIG.apiUrl, intentId) as any

      const response: Record<string, unknown> = {
        status: 'ok',
        intent_id: data.intent_id,
        payment_status: data.status,
        sending_amount: data.sending_amount,
        receiving_amount: data.receiving_amount,
        payer_chain: data.payer_chain,
        created_at: data.created_at,
        expires_at: data.expires_at,
      }

      if (data.status === PaymentStatus.BASE_SETTLED && data.source_payment) {
        response.tx_hash = data.source_payment.tx_hash
        response.explorer_url = data.source_payment.explorer_url
      }

      if (data.error_message) {
        response.error_message = data.error_message
      }

      output(response)
      return
    }

    output({ status: 'error', message: `Unknown command: "${command}". Run "tpay help" for usage.` })
    process.exitCode = 1

  } catch (e) {
    output({ status: 'error', message: sanitizeError(e) })
    process.exitCode = 1
  }
}

// Run when executed directly
if (import.meta.main) {
  runCli(process.argv.slice(2))
}
```

- [ ] **Step 4: Run integration tests**

```bash
bun test tests/integration.test.ts
```

Expected: all pass.

- [ ] **Step 5: Run all tests**

```bash
bun test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/integration.test.ts
git commit -m "feat: CLI entry point — send, intent status, version, help commands"
```

---

## Task 10: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write README**

```markdown
# @agentpay/tpay-cli

A CLI for AI agents to send USDC/USDT via the T402 x402 v2 payment protocol.
All output is structured JSON. Logs go to stderr.

## Commands

| Command | Description |
|---|---|
| `tpay send --to <addr> --amount <n> --chain <chain>` | Send payment |
| `tpay intent status <intent_id>` | Check payment status |
| `tpay version` | Print version |
| `tpay help` / `tpay --help` | Show all commands |
| `tpay send --help` | Show send args |

Global flag: `--verbose` — debug output to stderr.

Stdin JSON mode: pipe `{"to":"...","amount":"...","chain":"..."}` to `tpay send`.

## Supported Chains

| `--chain` value | Network |
|---|---|
| `base` | Base Mainnet (EVM) |
| `bsc` | BSC Mainnet (EVM) |
| `base-sepolia` | Base Sepolia (EVM testnet) |
| `solana` | Solana Mainnet |
| `solana-devnet` | Solana Devnet |

## Runtime Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WALLET_PROVIDER` | No (default: `env`) | Wallet plugin name |
| `WALLET_EVM_PRIVATE_KEY` | For EVM chains | Hex private key (`0x...`) |
| `WALLET_SOLANA_SEED` | For Solana | 64-byte seed as hex string |

## Build

```bash
T402_API_URL=https://api.example.com \
SOLANA_RPC_URL=https://your-rpc.example.com \
SOLANA_FEE_PAYER=<base58> \
bun build --compile src/index.ts --outfile tpay
```

## Development

```bash
bun install
bun test
T402_API_URL=https://... WALLET_EVM_PRIVATE_KEY=0x... bun run src/index.ts send --to 0x... --amount 1 --chain base
```

## Adding a New Chain Plugin

- [ ] Create `src/plugins/chains/<name>.ts`
- [ ] Implement `ChainPlugin` interface (`name`, `chains[]`, `sign()`)
- [ ] Add to `CHAIN_PLUGIN_LOADERS` in `src/loader.ts`
- [ ] Add to Supported Chains table above
- [ ] Test: verify x402 payload structure matches T402 backend

## Adding a New Wallet Plugin

- [ ] Create `src/plugins/wallets/<name>.ts`
- [ ] Implement `WalletPlugin` interface (`name`, `getEvmPrivateKey()`, `getSolanaSeed()`)
- [ ] Add to `WALLET_PLUGINS` map in `src/loader.ts`
- [ ] Document required env vars above
- [ ] Ensure key/seed return values are never logged
- [ ] Test: verify loads when `WALLET_PROVIDER=<name>` is set
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with usage, build, env vars, extension checklists"
```

---

## Task 11: Build Verification

**Files:** none new — verifies the full build pipeline.

- [ ] **Step 1: Set build env vars and run build**

```bash
T402_API_URL=https://api.example.com \
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
SOLANA_FEE_PAYER='' \
bun build --compile src/index.ts --outfile tpay
```

Expected: `tpay` binary created with no errors.

- [ ] **Step 2: Smoke test the binary**

```bash
./tpay version
```

Expected: `{"name":"@agentpay/tpay-cli","version":"0.0.1"}` — version is baked in (not read from package.json at runtime).

```bash
./tpay help
```

Expected: JSON with `commands` object.

```bash
./tpay send --help
```

Expected: JSON with `command: "send"` and `args`.

```bash
./tpay unknown-command
```

Expected: `{"status":"error","message":"Unknown command: ..."}`, exit code 1.

- [ ] **Step 3: Verify no RPC in EVM path**

Run `./tpay send --to test@example.com --amount 0.01 --chain base` with a valid `WALLET_EVM_PRIVATE_KEY` but no `BASE_RPC_URL`. Should fail only at the `createIntent` fetch (since T402 API URL is baked-in placeholder), not during signing.

- [ ] **Step 4: Final test run**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: build verification — tpay binary compiles and smoke tests pass"
```
