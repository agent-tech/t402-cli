#!/usr/bin/env node

import { loadEnv } from './env'
import { createLogger, setLogger, sanitizeError } from './logger'
import { resolveWalletPlugin, resolveChainPlugin } from './loader'
import { createIntent, runPayment, getIntentStatus } from './payment'
import { getConfig } from './macros/config.macro'
import { getVersion } from './macros/version.macro'
import type { GetPaymentIntentBaseSettledResponse } from './types'
import { PaymentStatus } from './types'

const CONFIG = getConfig()
const VERSION = getVersion()

type OutputFormat = 'json' | 'text'

function formatText(data: unknown, indent = 0): string {
  if (data === null || data === undefined) return ''
  if (typeof data !== 'object') return String(data)

  const pad = '  '.repeat(indent)
  const entries = Object.entries(data as Record<string, unknown>)
  return entries
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${pad}${k}:\n${v.map((item) => `${pad}  ${item}`).join('\n')}`
      }
      if (typeof v === 'object') {
        return `${pad}${k}:\n${formatText(v, indent + 1)}`
      }
      return `${pad}${k}: ${v}`
    })
    .join('\n')
}

function output(format: OutputFormat, data: unknown): void {
  if (format === 'text') {
    process.stdout.write(formatText(data) + '\n')
  } else {
    process.stdout.write(JSON.stringify(data) + '\n')
  }
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
    const timer = setTimeout(() => {
      process.stdin.off('data', onData)
      process.stdin.off('end', onEnd)
      resolve('')
    }, 100)

    function onData(chunk: string) { data += chunk }
    function onEnd() {
      clearTimeout(timer)
      resolve(data.trim())
    }

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', onData)
    process.stdin.on('end', onEnd)
  })
}

export async function runCli(argv: string[]): Promise<void> {
  loadEnv()
  const { args, flags, positional } = parseArgs(argv)
  const verbose = flags.has('--verbose')
  const format = (args['--format'] === 'text' ? 'text' : 'json') as OutputFormat
  const logger = createLogger(verbose)
  setLogger(logger)

  const [command, ...rest] = positional

  try {
    // Help commands — only show global help if no subcommand (or bare --help/help)
    if (!command || command === 'help' || (flags.has('--help') && !positional.length)) {
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
          'setup': 'Configure wallet keys. Use --from-env <file> to import from an env file',
          'send': 'Send USDC/USDT via T402. Args: --to, --amount, --chain, [--wallet-provider]',
          'intent status <intent_id>': 'Fetch current status of a payment intent',
          'version': 'Print CLI version',
          'help': 'Show this help',
        },
        supported_chains: {
          'base': 'Base Mainnet (EVM)',
          'bsc': 'BSC Mainnet (EVM)',
          'base-sepolia': 'Base Sepolia testnet (EVM)',
          'solana': 'Solana Mainnet',
          'solana-devnet': 'Solana Devnet',
        },
        env_vars: {
          'WALLET_SEED_PHRASE': 'BIP-39 mnemonic (required for Solana)',
          'WALLET_EVM_PRIVATE_KEY': 'Hex private key with 0x prefix (required for EVM)',
        },
        global_flags: {
          '--verbose': 'Enable debug logging to stderr',
          '--format': 'Output format: json (default) | text',
        },
        stdin: 'send accepts JSON via stdin: {"to":"...","amount":"...","chain":"..."}',
      })
      return
    }

    if (command === 'setup') {
      const { runSetup } = await import('./setup')
      const fromEnv = args['--from-env']
      const result = await runSetup(fromEnv ? { fromEnv } : undefined)
      output(format, { status: 'success', saved: result.saved })
      return
    }

    if (command === 'version') {
      output(format, VERSION)
      return
    }

    if (command === 'send') {
      if (flags.has('--help')) {
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
          try {
            const parsed = JSON.parse(stdinData)
            to = to || parsed.to
            amount = amount || parsed.amount
            chain = chain || parsed.chain
          } catch {
            output(format, { status: 'error', message: 'Invalid JSON on stdin' })
            process.exitCode = 1
            return
          }
        }
      }

      if (!to || !amount || !chain) {
        output(format, { status: 'error', message: 'Missing required args: --to, --amount, --chain' })
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
        output(format, {
          status: 'success',
          intent_id: intent.intent_id,
          tx_hash: settled.source_payment?.tx_hash,
          explorer_url: settled.source_payment?.explorer_url,
        })
      } else {
        output(format, { status: 'error', message: result.message ?? 'Payment failed' })
        process.exitCode = 1
      }
      return
    }

    if (command === 'intent' && rest[0] === 'status') {
      let intentId = rest[1]

      if (!intentId) {
        const stdinData = await readStdin()
        if (stdinData) {
          try {
            const parsed = JSON.parse(stdinData)
            intentId = parsed.intent_id
          } catch {
            output(format, { status: 'error', message: 'Invalid JSON on stdin' })
            process.exitCode = 1
            return
          }
        }
      }

      if (!intentId) {
        output(format, { status: 'error', message: 'Missing intent_id' })
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

      output(format, response)
      return
    }

    output(format, { status: 'error', message: `Unknown command: "${command}". Run "tpay help" for usage.` })
    process.exitCode = 1

  } catch (e) {
    let message = sanitizeError(e)
    // Scrub any sensitive values from error messages
    const evmKey = process.env.WALLET_EVM_PRIVATE_KEY
    const seedPhrase = process.env.WALLET_SEED_PHRASE
    if (evmKey) message = message.replaceAll(evmKey, '[REDACTED]')
    if (seedPhrase) message = message.replaceAll(seedPhrase, '[REDACTED]')
    output(format, { status: 'error', message })
    process.exitCode = 1
  }
}

// Run when executed directly
if (import.meta.main) {
  runCli(process.argv.slice(2))
}
