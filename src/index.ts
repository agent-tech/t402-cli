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
    // Help commands — only show global help if no subcommand (or bare --help/help)
    if (!command || command === 'help' || (flags.has('--help') && !positional.length)) {
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

      const result = await runPayment(CONFIG.apiUrl, intent, settleProof, 0)

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
    let message = sanitizeError(e)
    // Scrub any private key values from error messages
    const evmKey = process.env.WALLET_EVM_PRIVATE_KEY
    const solKey = process.env.WALLET_SOLANA_PRIVATE_KEY
    if (evmKey) message = message.replaceAll(evmKey, '[REDACTED]')
    if (solKey) message = message.replaceAll(solKey, '[REDACTED]')
    output({ status: 'error', message })
    process.exitCode = 1
  }
}

// Run when executed directly
if (import.meta.main) {
  runCli(process.argv.slice(2))
}
