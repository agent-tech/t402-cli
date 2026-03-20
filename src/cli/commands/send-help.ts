import type { OutputFormat } from '../output'
import { output } from '../output'

export function runSendHelp(format: OutputFormat): void {
  output(format, {
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
}
