import type { OutputFormat } from '../output'
import { output } from '../output'

export function runSendHelp(format: OutputFormat): void {
  output(format, {
    command: 'send',
    description: 'Send USDC/USDT via T402 x402 protocol',
    args: {
      '--to': 'Recipient wallet address (required)',
      '--amount': 'Amount to send, e.g. "10" (required)',
    },
    stdin: 'Accepts JSON: {"to": "...", "amount": "..."}',
  })
}
