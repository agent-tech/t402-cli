import type { CliContext } from '../types'
import { output } from '../output'

export async function runHelp(ctx: CliContext): Promise<number> {
  const { format } = ctx
  output(format, {
    description: 'CLI for sending USDC/USDT payments via the T402 x402 protocol',
    payment_flow: [
      '1. Setup: run `tpay setup --from-env <file>` or `tpay setup` to configure wallet keys',
      '2. Send: run `tpay send --to <recipient> --amount <n> --chain <chain>` to create and execute a payment',
      '   - The CLI creates a payment intent with the T402 API',
      '   - Signs the transaction using the configured wallet (seed phrase for Solana, private key for EVM)',
      '   - Submits the signed proof and polls until settlement',
      '   - Returns intent_id, tx_hash, and explorer_url on success',
      '3. Verify: run `tpay intent status <intent_id>` to check payment status at any time',
    ],
    commands: {
      setup: 'Configure wallet keys with encryption. Use --from-env <file> to import. Non-interactive: WALLET_SEED_PHRASE="..." TPAY_PASSPHRASE="..." tpay setup',
      send: 'Send USDC/USDT via T402. Args: --to, --amount, --chain, [--wallet-provider]',
      'intent status <intent_id>': 'Fetch current status of a payment intent',
      version: 'Print CLI version',
      help: 'Show this help',
    },
    supported_chains: {
      solana: 'Solana Mainnet',
      'solana-devnet': 'Solana Devnet',
    },
    env_vars: {
      WALLET_SEED_PHRASE: 'BIP-39 mnemonic (bypasses encrypted config if set directly)',
      TPAY_PASSPHRASE: 'Passphrase for decrypting config file (cleared from env after use)',
      SOLANA_FEE_PAYER: 'Override fee payer address (build-time default used if unset)',
    },
    global_flags: {
      '--verbose': 'Enable debug logging to stderr',
      '--format': 'Output format: json (default) | text',
    },
    stdin: 'send accepts JSON via stdin: {"to":"...","amount":"...","chain":"..."}',
    runtime_note: 'Set TPAY_PASSPHRASE in environment to skip passphrase prompt on each run.',
  })
  return 0
}
