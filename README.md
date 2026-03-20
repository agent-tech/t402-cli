# @agenttech/tpay-cli

Send USDT payments on Solana via the T402 x402 v2 protocol. Designed for AI agents — all output is structured JSON on stdout, logs go to stderr.

## Install

```bash
npm install -g @agenttech/tpay-cli
```

Verify:

```bash
tpay version
```

## Setup

The CLI needs a BIP-39 seed phrase to sign transactions. Two setup paths:

### Non-interactive (recommended for agents)

```bash
WALLET_SEED_PHRASE="your twelve or twenty four word seed phrase here" \
TPAY_PASSPHRASE="encryption-password" \
tpay setup
```

This encrypts and saves the seed phrase to `~/.config/tpay/.env`.

### From env file

```bash
tpay setup --from-env /path/to/.env
```

The file must contain `WALLET_SEED_PHRASE=...`.

### Skip setup (inline seed phrase)

You can skip `tpay setup` entirely by passing the seed phrase as an environment variable on every call:

```bash
WALLET_SEED_PHRASE="your seed phrase" tpay send --to <address> --amount 10
```

### Setup output

```json
{"status":"success","saved":true}
```

## Commands

### `tpay send`

Send a USDT payment.

```bash
tpay send --to <solana-address> --amount <number>
```

Or pipe JSON via stdin:

```bash
echo '{"to":"<solana-address>","amount":"10"}' | tpay send
```

**Success output:**

```json
{"status":"success","intent_id":"intent_abc123","tx_hash":"5xY...","explorer_url":"https://..."}
```

**Error output:**

```json
{"status":"error","error_type":"payment_error","message":"Payment failed","intent_id":"intent_abc123"}
```

### `tpay balance`

Check SOL and USDT balances for any address. No wallet keys required.

```bash
tpay balance --address <solana-address>
```

**Output:**

```json
{"status":"ok","address":"<solana-address>","sol":"1.5","usdt":"100.0"}
```

### `tpay intent status`

Check the status of a payment intent.

```bash
tpay intent status <intent_id>
```

Or via stdin:

```bash
echo '{"intent_id":"intent_abc123"}' | tpay intent status
```

**Output:**

```json
{"status":"ok","intent_id":"intent_abc123","payment_status":"BASE_SETTLED","sending_amount":"10","receiving_amount":"10","payer_chain":"solana","created_at":"...","expires_at":"...","tx_hash":"5xY...","explorer_url":"https://..."}
```

### `tpay version`

```bash
tpay version
```

### `tpay help`

```bash
tpay help
```

## Global Flags

| Flag | Description |
|---|---|
| `--verbose` | Debug logs to stderr |
| `--format json\|text` | Output format (default: `json`) |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WALLET_SEED_PHRASE` | Yes (if no config file) | BIP-39 mnemonic (12–24 words) |
| `TPAY_PASSPHRASE` | No | Decrypts saved config at `~/.config/tpay/.env` |
| `SOLANA_FEE_PAYER` | No | Override fee payer address |

If both `WALLET_SEED_PHRASE` env var and an encrypted config file exist, the env var takes precedence.

## Exit Codes

| Code | Type | Meaning |
|---|---|---|
| 0 | — | Success |
| 1 | `validation_error` | Invalid arguments or input |
| 2 | `runtime_error` | Unexpected runtime failure |
| 3 | `configuration_error` | Missing or invalid config |
| 4 | `network_error` | API or RPC failure |
| 5 | `payment_error` | Payment-specific failure |

All errors output JSON to stdout:

```json
{"status":"error","error_type":"<type>","message":"<description>"}
```

## Supported Chains

| Chain | Network ID |
|---|---|
| Solana Mainnet | `solana` |
| Solana Devnet | `solana-devnet` |

## License

ISC
