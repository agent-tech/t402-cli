# @agentpay/tpay-cli

A CLI for AI agents to send USDC/USDT via the T402 x402 v2 payment protocol.
Output defaults to structured JSON. Use `--format text` for human-readable output. Logs go to stderr.

## Commands

| Command | Description |
|---|---|
| `tpay setup` | Configure wallet keys interactively |
| `tpay setup --from-env <file>` | Import keys from an env file |
| `tpay send --to <addr> --amount <n> --chain <chain>` | Send payment |
| `tpay intent status <intent_id>` | Check payment status |
| `tpay version` | Print version |
| `tpay help` / `tpay --help` | Show all commands |
| `tpay send --help` | Show send args |

Global flags:
- `--verbose` — debug output to stderr
- `--format text|json` — output format (default: `json`)

```bash
# JSON output (default, for programmatic use)
tpay send --to 0x... --amount 10 --chain base
{"status":"success","intent_id":"...","tx_hash":"...","explorer_url":"..."}

# Text output (human-readable)
tpay send --to 0x... --amount 10 --chain base --format text
status: success
intent_id: abc123
tx_hash: 0x...
explorer_url: https://...
```

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
| `WALLET_SEED_PHRASE` | Yes (for Solana) | BIP-39 mnemonic seed phrase |
| `WALLET_EVM_PRIVATE_KEY` | For EVM chains | Hex private key (`0x...`) |

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
