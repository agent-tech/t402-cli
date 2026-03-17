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
