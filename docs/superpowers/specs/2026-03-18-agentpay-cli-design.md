# agentpay-cli Design Spec

**Date:** 2026-03-18
**Project:** `@agentpay/tpay-cli`
**Status:** Approved

---

## Overview

A TypeScript CLI for AI agents to send USDC/USDT via the T402 x402 payment protocol. The agent calls `tpay send` with a recipient and amount; the CLI creates a payment intent, signs it, submits the proof, and outputs a JSON result.

> **Token note:** EVM chains (Base, BSC) settle in **USDC**. Solana settles in the token specified by the backend in `payment_requirements.asset`. The CLI does not hardcode a token assumption — all token details come from the intent response.

Built with Bun (runtime + bundler). Compiled to a single self-contained binary via `bun build --compile`. Build-time configuration is embedded using Bun macros so the distributed binary has no external config-file dependencies.

---

## Stack

| Concern | Choice |
|---|---|
| Runtime / bundler | Bun |
| Language | TypeScript |
| Output | Single binary (`bun build --compile`) |
| Build-time config | Bun macros |
| EVM wallet | `@tetherto/wdk-wallet-evm` |
| Solana wallet | `@tetherto/wdk-wallet-solana` |
| Payment protocol | T402 x402 v2 |

---

## Architecture

Three-layer plugin architecture:

```
CLI runner (index.ts)
  └── loader.ts          resolves wallet + chain plugins by name
        ├── PaymentClient (payment.ts)   T402 API calls
        ├── WalletPlugin  (plugins/wallets/*.ts)
        └── ChainPlugin   (plugins/chains/*.ts)
```

Plugins are resolved by `loader.ts` using a static switch/map (not a fully dynamic import string) so that `bun build --compile` can statically trace all plugin files and bundle them into the binary. Adding a new wallet backend or chain requires adding a new file implementing the relevant interface and adding it to the loader's static map.

---

## Directory Structure

```
agentpay-cli/
├── src/
│   ├── index.ts                    # Entry: parse args or stdin JSON, dispatch
│   ├── loader.ts                   # Plugin loader — static map of known plugins
│   ├── payment.ts                  # T402 API client
│   ├── logger.ts                   # Logger: debug/info → stderr; respects --verbose
│   ├── types.ts                    # Shared types (mirrored from PaymentFlow.types.ts)
│   ├── macros/
│   │   └── config.macro.ts         # Bun macro: embed config at build time
│   └── plugins/
│       ├── wallets/
│       │   ├── types.ts            # WalletPlugin interface
│       │   └── env.ts              # Default: reads keys from env vars
│       └── chains/
│           ├── types.ts            # ChainPlugin interface
│           ├── evm.ts              # Base + BSC — EIP-712 TransferWithAuthorization
│           └── solana.ts           # Solana — SPL TransferChecked x402 payload
├── tsconfig.json
├── package.json
└── README.md
```

---

## Bun Macro: Build-time Config

`src/macros/config.macro.ts` runs at `bun build` time. Values from the build environment are embedded as literals in the output binary.

```ts
export function getConfig() {
  return {
    apiUrl: process.env.T402_API_URL ?? '',
    solana: {
      rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
      // Fallback only — intent response payment_requirements.extra.feePayer takes priority
      feePayer: process.env.SOLANA_FEE_PAYER ?? '',
    },
  }
}
```

Usage in source:
```ts
import { getConfig } from '../macros/config.macro.ts' with { type: 'macro' }
const CONFIG = getConfig() // replaced with object literal at build time
```

No EVM RPC is needed — EVM signing is pure EIP-712 cryptography with no network calls.

---

## Shared Types (`src/types.ts`)

Mirrors `fe-t402-pay/src/modules/paymentFlow/types/PaymentFlow.types.ts`. Key types the CLI uses:

```ts
export enum PaymentStatus {
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PENDING = 'PENDING',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  SOURCE_SETTLED = 'SOURCE_SETTLED',
  BASE_SETTLING = 'BASE_SETTLING',
  BASE_SETTLED = 'BASE_SETTLED',
  EXPIRED = 'EXPIRED',
}

export interface PaymentRequirements {
  scheme: string
  network: string          // CAIP-2 format: 'eip155:8453', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
  amount: string           // atomic units
  payTo: string
  maxTimeoutSeconds: number
  asset: string            // token contract/mint address
  extra: {
    name?: string          // EIP-712 domain name (e.g. 'USD Coin')
    version?: string       // EIP-712 domain version (e.g. '2')
    feePayer?: string      // Solana fee payer address (backend-provided)
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

// GetPaymentIntentResponse is a discriminated union on status:
// BASE_SETTLED includes source_payment: { tx_hash, explorer_url, ... }
//                        base_payment:  { tx_hash, explorer_url, ... }
// VERIFICATION_FAILED | EXPIRED include error_message: string
```

---

## Plugin Interfaces

### WalletPlugin (`plugins/wallets/types.ts`)

```ts
export interface WalletPlugin {
  name: string
  getEvmPrivateKey(): string        // hex private key (0x...)
  getSolanaSeed(): Uint8Array       // 64-byte seed
}
```

### ChainPlugin (`plugins/chains/types.ts`)

```ts
export interface ChainPlugin {
  name: string
  chains: string[]                  // payer_chain values this plugin handles
  sign(intent: PaymentIntentResponse, wallet: WalletPlugin): Promise<string>
  // returns base64-encoded x402 v2 payload string
}
```

### Plugin Loader (`loader.ts`)

Uses a static map so Bun can trace all imports at bundle time:

```ts
// Wallet plugins — keyed by WALLET_PROVIDER env var
const WALLET_PLUGINS: Record<string, () => Promise<WalletPlugin>> = {
  env: () => import('./plugins/wallets/env').then(m => m.default),
}

// Chain plugins — matched by payer_chain string
const CHAIN_PLUGINS: Array<() => Promise<ChainPlugin>> = [
  () => import('./plugins/chains/evm').then(m => m.default),
  () => import('./plugins/chains/solana').then(m => m.default),
]
```

Loader resolves wallet plugin via `WALLET_PROVIDER` env var (default: `env`). Chain plugin is selected by finding the first plugin whose `chains` array includes `intent.payer_chain`.

---

## T402 Payment Flow (`payment.ts`)

```
1. POST /api/intents          { to, amount, payer_chain }  → PaymentIntentResponse
2. ChainPlugin.sign(intent)   pure local signing           → base64 x402 payload
3. POST /api/intents/:id      { settle_proof: payload }    → (PENDING, ignore)
4. Poll GET /api/intents?intent_id=:id  every 2000 ms until terminal state
```

All API calls use `fetch` with the macro-baked `apiUrl`.

### Request Timeout Policy

Each API call has a **30-second timeout** via `AbortController`.

| Call | On timeout | On 5xx |
|---|---|---|
| `POST /api/intents` (create) | Output JSON error, exit 1 | Output JSON error, exit 1 |
| `POST /api/intents/:id` (submit proof) | Output JSON error, exit 1 | Output JSON error, exit 1 |
| `GET /api/intents?intent_id=:id` (poll) | Skip this tick, retry next 2000 ms interval | Skip this tick, retry next 2000 ms interval |

**Rationale for poll skip:** A single timed-out or failed GET poll is transient — the payment may still settle. Retrying on the next tick is safe since GET is idempotent. POST timeouts are not retried because the server may have already processed the request (unsafe to retry).

**No 5xx retries** on any call. Surface errors immediately except for poll ticks.

### Polling Stop Conditions (matching `usePaymentintent.ts`)

- `status === BASE_SETTLED` → success
- `status === VERIFICATION_FAILED` → error: `"Verification failed: <error_message>"`
- `error_message` is present → error: `"Verification failed: <error_message>"`
- `status === EXPIRED` → error: `"Payment expired"`
- All other statuses (`PENDING`, `AWAITING_PAYMENT`, `SOURCE_SETTLED`, `BASE_SETTLING`) → continue polling

**Outer polling deadline:** stop polling when `Date.now() > Date.parse(intent.expires_at)` — output error `"Payment expired"` if reached before a terminal status.

Submit-proof response (`POST /api/intents/:id`) returns `PENDING` — always ignore and proceed straight to polling.

---

## Logging (`src/logger.ts`)

All log output goes to **stderr**. **stdout is reserved exclusively for JSON output.**

```ts
export function log(message: string, data?: unknown) { /* writes to stderr */ }
export function debug(message: string, data?: unknown) { /* writes to stderr, only if verbose=true */ }
```

`--verbose` flag sets `verbose = true`. Debug logs include request details, response bodies, signing steps, and poll ticks.

### Security Rules for Logging

These rules apply everywhere in the codebase:

1. **Never log private key or seed values.** `WALLET_EVM_PRIVATE_KEY` and `WALLET_SOLANA_SEED` env var values must never appear in any log line, error message, or JSON output. Log the variable name if needed, not its value.
2. **Sanitize caught errors before output.** In `catch` blocks, extract only `error.message` — never spread the full error object (it may contain wallet internals). Use a `sanitizeError(e: unknown): string` helper that extracts only the message string.
3. **No wallet internals in JSON error output.** The `{ "status": "error", "message": "..." }` output must never contain private keys, seeds, or signatures.

```ts
// Correct
catch (e) {
  output({ status: 'error', message: sanitizeError(e) })
}

// WRONG — never do this
catch (e) {
  output({ status: 'error', error: e })  // may expose wallet data
}
```

---

## EVM Signing (`plugins/chains/evm.ts`)

Implements EIP-712 `TransferWithAuthorization`. No RPC required — pure cryptographic signing using `WalletAccountEvm.signTypedData()` from `@tetherto/wdk-wallet-evm`.

### Handled chains

`chains: ['base', 'bsc', 'base-sepolia']`

Chain ID is parsed from the CAIP-2 `network` field in `payment_requirements`:
- `eip155:8453` → chainId `8453` (Base)
- `eip155:56` → chainId `56` (BSC)
- `eip155:84532` → chainId `84532` (Base Sepolia)

### EIP-712 Domain Construction

The domain is constructed from `payment_requirements`, NOT from a hardcoded map:

```ts
const domain = {
  name: intent.payment_requirements.extra.name,       // e.g. 'USD Coin'
  version: intent.payment_requirements.extra.version, // e.g. '2'
  chainId: chainId,                                    // parsed from network CAIP-2
  verifyingContract: intent.payment_requirements.asset // e.g. '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
}
```

Use the asset address exactly as provided by the backend (do not re-checksum). The backend provides lowercase addresses; EIP-712 encoding handles them correctly.

### Message & Payload Structure

```ts
const message = {
  from: walletAddress,
  to: intent.payment_requirements.payTo,
  value: intent.payment_requirements.amount,
  validAfter: String(now - 600),
  validBefore: String(now + 600),
  nonce: '0x' + crypto.randomBytes(32).toString('hex'),
}

// asset: always use intent.payment_requirements.asset — the backend is authoritative.
// The CLI has no fallback address map (unlike the browser reference which had USDC_ADDRESSES
// as a safety net). If the backend omits asset, throw an error.
const asset = intent.payment_requirements.asset
if (!asset) throw new Error('payment_requirements.asset missing from intent')

// x402 v2 payload (matches fe-t402-pay useEVMSignData.ts)
// extra: pass through the full payment_requirements.extra object (includes name, version, etc.)
const payload = {
  x402Version: 2,
  resource: { url: `/api/intents/${intent.intent_id}`, ... },
  accepted: { scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra: intent.payment_requirements.extra },
  payload: { signature, authorization: { from, to, value, validAfter, validBefore, nonce } },
}
return Buffer.from(JSON.stringify(payload)).toString('base64')
```

---

## Solana Signing (`plugins/chains/solana.ts`)

Builds an x402 v2 VersionedTransaction with exactly 3 instructions (per x402 spec):
1. `SetComputeUnitLimit(200000)`
2. `SetComputeUnitPrice(1)`
3. `TransferChecked` (SPL token)

Uses WDK `WalletAccountSolana` for key derivation and signing. Requires Solana RPC to fetch `getLatestBlockhash`.

### Handled chains

`chains: ['solana', 'solana-devnet']`

CAIP-2 network values from mock data:
- `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` = mainnet (`payer_chain: 'solana'`)
- `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` = devnet (`payer_chain: 'solana-devnet'`)

### Fee Payer Resolution

Priority order:
1. `intent.payment_requirements.extra.feePayer` (backend-provided, takes priority)
2. Macro-baked `SOLANA_FEE_PAYER` fallback

The fee payer is the **backend's address** — the backend co-signs when verifying the proof. The CLI does not hold the fee payer's private key. The CLI sets the fee payer in the transaction message and signs only with the user's wallet key. The backend verifies and co-signs during proof submission.

### Base64 Encoding

Use `Buffer.from(signedTransaction).toString('base64')` (not `btoa(String.fromCharCode(...))`). All base64 encoding in this project uses the `Buffer` API for Bun compatibility.

### Payload Structure

```ts
// accepted.extra: strip to { feePayer } ONLY — do NOT pass through the full
// payment_requirements.extra (unlike EVM which passes extra through completely).
// This matches useSolanaSignData.ts lines 308-319 exactly.
const payload = {
  x402Version: 2,
  resource: { url: `/api/intents/${intent.intent_id}`, ... },
  accepted: { scheme, network: networkCAIP2, amount, asset, payTo, maxTimeoutSeconds, extra: { feePayer } },
  payload: { transaction: Buffer.from(signedTransaction).toString('base64') },
}
return Buffer.from(JSON.stringify(payload)).toString('base64')
```

---

## Default Wallet Plugin: `env` (`plugins/wallets/env.ts`)

Reads credentials from environment variables at runtime:

```
WALLET_EVM_PRIVATE_KEY=0x...       hex private key for EVM signing
WALLET_SOLANA_SEED=<hex>           64-byte seed as hex string for Solana signing
```

Future wallet plugins implement `WalletPlugin` and are placed in `plugins/wallets/`, then registered in `loader.ts`'s static map.

---

## CLI Interface

The entry point (`index.ts`) supports two input modes. If `stdin` is a pipe and no subcommand args are provided, it reads JSON from stdin. Otherwise it parses CLI arguments.

**Global flag:** `--verbose` — enables debug logging to stderr. Valid on all commands.

**All stdout output is structured JSON.** No plaintext is ever written to stdout. Log/debug messages go to stderr only.

### Commands

#### `tpay send`

Send USDC/USDT via T402.

```bash
tpay send --to <address|email> --amount <number> --chain <chain-id> [--verbose]
tpay send --to 0xABC... --amount 10 --chain base
tpay send --to user@email.com --amount 5 --chain solana
tpay send --to 0xABC... --amount 10 --chain bsc --wallet-provider env
```

Stdin JSON mode (when stdin is a pipe):
```bash
echo '{"to":"0xABC...","amount":"10","chain":"base"}' | tpay send
```

**Success output:**
```json
{
  "status": "success",
  "intent_id": "...",
  "tx_hash": "...",
  "explorer_url": "..."
}
```
`tx_hash` is `source_payment.tx_hash` from the `BASE_SETTLED` response. Exit code `0`.

**Error output:**
```json
{ "status": "error", "message": "..." }
```
Exit code `1`.

---

#### `tpay intent status <intent_id>`

Fetch the current status of an existing payment intent. Does not sign or submit anything — read-only API call.

```bash
tpay intent status 3b154135-4091-4f23-b962-4871d7160dea [--verbose]
```

Stdin JSON mode:
```bash
echo '{"intent_id":"3b154135-..."}' | tpay intent status
```

**Output:**
```json
{
  "status": "ok",
  "intent_id": "...",
  "payment_status": "BASE_SETTLED",
  "sending_amount": "0.03",
  "receiving_amount": "0.02797",
  "payer_chain": "base",
  "created_at": "...",
  "expires_at": "...",
  "tx_hash": "...",
  "explorer_url": "..."
}
```

`tx_hash` and `explorer_url` are included only when `payment_status` is `BASE_SETTLED`. `error_message` is included when `payment_status` is `VERIFICATION_FAILED` or `EXPIRED`.

Exit code `0` on successful API call (regardless of payment status). Exit code `1` on API error.

---

#### `tpay help` / `tpay --help`

Display all available subcommands and global flags.

```bash
tpay help
tpay --help
```

**Output:**
```json
{
  "commands": {
    "send": "Send USDC/USDT via T402. Args: --to, --amount, --chain, [--wallet-provider]",
    "intent status <intent_id>": "Fetch current status of a payment intent",
    "version": "Print CLI version",
    "help": "Show this help"
  },
  "global_flags": {
    "--verbose": "Enable debug logging to stderr"
  }
}
```

#### `tpay send --help`

Display parameters for the `send` command.

```bash
tpay send --help
```

**Output:**
```json
{
  "command": "send",
  "description": "Send USDC/USDT via T402 x402 protocol",
  "args": {
    "--to": "Recipient wallet address or email (required)",
    "--amount": "Amount to send, e.g. '10' (required)",
    "--chain": "Chain ID: base | bsc | base-sepolia | solana | solana-devnet (required)",
    "--wallet-provider": "Wallet plugin name, default: env"
  },
  "stdin": "Accepts JSON: {\"to\": \"...\", \"amount\": \"...\", \"chain\": \"...\"}"
}
```

Exit code `0` for all help commands.

---

#### `tpay version`

Print CLI version information.

```bash
tpay version
```

**Output:**
```json
{
  "name": "@agentpay/tpay-cli",
  "version": "0.0.1"
}
```

Version is read from `package.json` at build time via a Bun macro (same pattern as `config.macro.ts`). Exit code `0`.

---

### Error Output (all commands)

```json
{ "status": "error", "message": "<sanitized message>" }
```

Error message rules:
- `VERIFICATION_FAILED` → `"Verification failed: <error_message>"`
- `EXPIRED` or expired polling deadline → `"Payment expired"`
- Request timeout (POST calls) → `"Request timeout"`
- 5xx response → `"Server error: <status_code>"`
- API/network error → the sanitized error message (no private key or seed values)

---

## Security Rules

1. **Private key and seed never logged.** `WALLET_EVM_PRIVATE_KEY` and `WALLET_SOLANA_SEED` values must not appear in any log line, debug output, or JSON error output. Log the variable name if needed, not its value.
2. **Sanitize all caught errors.** Use `sanitizeError(e: unknown): string` everywhere — extract `error.message` only, never spread the full error object.
3. **No 5xx retry.** Do not retry on server errors — fail fast.
4. **POST timeout = immediate failure.** Do not retry timed-out POST calls (server may have processed them).

---

## Runtime Environment Variables

Only wallet credentials are runtime env vars. Everything else is baked in at build time.

| Variable | Required | Description |
|---|---|---|
| `WALLET_PROVIDER` | No (default: `env`) | Wallet plugin name to load |
| `WALLET_EVM_PRIVATE_KEY` | For EVM chains | Hex private key (`0x...`) |
| `WALLET_SOLANA_SEED` | For Solana | 64-byte seed as hex string |

---

## Build

```bash
T402_API_URL=https://api.example.com \
SOLANA_RPC_URL=https://your-rpc.example.com \
SOLANA_FEE_PAYER=<base58-fallback> \
bun build --compile src/index.ts --outfile tpay
```

Outputs a single `tpay` binary with all config embedded. The binary has no external config-file dependencies at runtime.

---

## Supported Chains (v1)

| `payer_chain` value | CAIP-2 network | Type |
|---|---|---|
| `base` | `eip155:8453` | EVM |
| `bsc` | `eip155:56` | EVM |
| `base-sepolia` | `eip155:84532` | EVM (testnet) |
| `solana` | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | Solana |
| `solana-devnet` | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | Solana (testnet) |

---

## Testing

### Unit Tests

| Subject | What to verify |
|---|---|
| `sanitizeError()` | Strips objects to message string; never exposes private key or seed values in output |
| EVM chain plugin | `sign()` produces a valid base64 x402 v2 payload; domain construction from `payment_requirements`; correct `extra` passthrough |
| Solana chain plugin | `sign()` produces a valid base64 x402 v2 payload; `accepted.extra` is `{ feePayer }` only; correct base64 encoding via `Buffer` |
| `loader.ts` | Resolves correct wallet plugin from `WALLET_PROVIDER`; resolves correct chain plugin from `payer_chain` |
| Polling logic | Stops on `BASE_SETTLED`, `VERIFICATION_FAILED`, `error_message`, `EXPIRED`; continues on `PENDING`/`AWAITING_PAYMENT`; respects `expires_at` outer deadline |

### Integration Tests

Mock the T402 API (using `mockingData.ts` values from the reference as fixtures):

| Scenario | Expected outcome |
|---|---|
| EVM happy path (base) | `send` outputs `{ status: "success", tx_hash, explorer_url }` |
| Solana happy path | `send` outputs `{ status: "success", tx_hash, explorer_url }` |
| `VERIFICATION_FAILED` | `send` outputs `{ status: "error", message: "Verification failed: ..." }` |
| `EXPIRED` | `send` outputs `{ status: "error", message: "Payment expired" }` |
| 5xx on create intent | `send` outputs `{ status: "error", message: "Server error: 500" }` |
| 30s timeout on POST | `send` outputs `{ status: "error", message: "Request timeout" }` |
| `tpay intent status` | Outputs correct shape for each `PaymentStatus` value |
| `--verbose` | Debug messages go to stderr; stdout is still valid JSON |

---

## Extension Checklists

### Adding a New Chain Plugin

- [ ] Create `src/plugins/chains/<chain-name>.ts`
- [ ] Implement the `ChainPlugin` interface (`name`, `chains[]`, `sign()`)
- [ ] Define the `chains` array with all `payer_chain` string values this plugin handles
- [ ] Add the plugin factory to `CHAIN_PLUGINS` array in `src/loader.ts` (static import)
- [ ] Add supported chains to the Supported Chains table in README
- [ ] Test: verify the x402 payload structure matches the T402 backend's expected format

### Adding a New Wallet Plugin

- [ ] Create `src/plugins/wallets/<provider-name>.ts`
- [ ] Implement the `WalletPlugin` interface (`name`, `getEvmPrivateKey()`, `getSolanaSeed()`)
- [ ] Add the plugin factory to `WALLET_PLUGINS` map in `src/loader.ts` keyed by provider name
- [ ] Document required env vars or config for the new plugin in README
- [ ] Ensure `getEvmPrivateKey()` and `getSolanaSeed()` never log their return values
- [ ] Test: verify the plugin loads correctly when `WALLET_PROVIDER=<provider-name>` is set
