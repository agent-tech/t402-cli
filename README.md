# @agenttech/tpay-cli

A CLI for AI agents to send USDT via the T402 x402 v2 payment protocol on Solana.
Output defaults to structured JSON. Use `--format text` for human-readable output. Logs go to stderr.

## Commands

| Command | Description |
|---|---|
| `tpay setup` | Configure wallet keys interactively |
| `tpay setup --from-env <file>` | Import keys from an env file |
| `tpay send --to <addr> --amount <n>` | Send payment |
| `tpay balance --address <addr>` | Show wallet SOL and USDT balances |
| `tpay intent status <intent_id>` | Check payment status |
| `tpay version` | Print version |
| `tpay help` / `tpay --help` | Show all commands |
| `tpay send --help` | Show send args |

Global flags:
- `--verbose` — debug output to stderr
- `--format text|json` — output format (default: `json`)

```bash
# JSON output (default, for programmatic use)
tpay send --to <solana-address> --amount 10
{"status":"success","intent_id":"...","tx_hash":"...","explorer_url":"..."}

# Text output (human-readable)
tpay send --to <solana-address> --amount 10 --format text
status: success
intent_id: abc123
tx_hash: ...
explorer_url: https://...
```

```bash
# Check wallet balance (read-only, no keys needed)
tpay balance --address <solana-address>
{"status":"ok","address":"<solana-address>","sol":"0.5","usdt":"100.0"}
```

Stdin JSON mode: pipe `{"to":"...","amount":"..."}` to `tpay send`.

## Supported Chains

| Network |
|---|
| Solana Mainnet |
| Solana Devnet |

## Runtime Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WALLET_SEED_PHRASE` | Yes | BIP-39 mnemonic seed phrase |
| `TPAY_PASSPHRASE` | No | Passphrase for decrypting config file (cleared from env after use) |
| `SOLANA_FEE_PAYER` | No | Override fee payer address (build-time default used if unset) |

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
WALLET_SEED_PHRASE="..." bun run src/index.ts send --to <solana-address> --amount 1
```

## Adding a New Chain Plugin

- [ ] Create `src/plugins/chains/<name>.ts`
- [ ] Implement `ChainPlugin` interface (`name`, `chains[]`, `sign()`)
- [ ] Add to `CHAIN_PLUGIN_LOADERS` in `src/loader.ts`
- [ ] Add to Supported Chains table above
- [ ] Test: verify x402 payload structure matches T402 backend
