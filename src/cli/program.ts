import { Command } from 'commander'
import { loadEnv } from '../env'
import { setLogger, sanitizeError, createLogger } from '../logger'
import { createCliContext } from './context'
import { wrapError } from './errors'
import { outputError } from './output'
import type { RootOptions, SendOptions, SetupOptions, CliContext } from './types'
import { runHelp } from './commands/help'
import { runVersion } from './commands/version'
import { runSetup } from './commands/setup'
import { runSend } from './commands/send'
import { runIntentStatus } from './commands/intent-status'
import { getVersion } from '../macros/version.macro'

export function createProgram(): Command {
  const program = new Command()
  const versionInfo = getVersion()
  const versionString = typeof versionInfo === 'string' ? versionInfo : versionInfo.version

  program
    .name('tpay')
    .version(versionString, '-v, --version', 'Show version')
    .option('--verbose', 'Enable debug logging to stderr')
    .option('--format <fmt>', 'Output format: json | text', 'json')

  program.hook('preAction', () => {
    const rootOpts = program.opts<RootOptions>()
    const format = rootOpts.format === 'text' ? ('text' as const) : ('json' as const)
    const logger = createLogger(!!rootOpts.verbose)
    const cliContext: CliContext = {
      format,
      logger,
      rootOptions: rootOpts,
    };
    (program as any)._cliContext = cliContext
    setLogger(logger)
  })

  registerCommands(program)

  return program
}

function registerCommands(program: Command): void {
  const getContext = (): CliContext => {
    const rootOpts = program.opts<RootOptions>()
    return createCliContext(rootOpts)
  }

  program.action(async () => {
    process.exitCode = await runHelp(getContext())
  })

  program
    .command('help')
    .description('Show help information')
    .action(async () => {
      process.exitCode = await runHelp(getContext())
    })

  program
    .command('version')
    .description('Show CLI version')
    .action(async () => {
      process.exitCode = await runVersion(getContext())
    })

  program
    .command('setup')
    .description('Configure wallet keys with encryption')
    .option('--from-env <file>', 'Import from env file')
    .action(async (opts: SetupOptions) => {
      process.exitCode = await runSetup(getContext(), opts)
    })

  program
    .command('send')
    .description('Send USDC/USDT via T402')
    .option('--to <recipient>', 'Recipient address or email')
    .option('--amount <n>', 'Amount to send')
    .option('--chain <id>', 'Chain ID')
    .option('--wallet-provider <name>', 'Wallet plugin name')
    .action(async (opts: SendOptions) => {
      await loadEnv()
      process.exitCode = await runSend(getContext(), opts)
    })

  const intentCmd = program
    .command('intent')
    .description('Payment intent operations')

  intentCmd
    .command('status [intentId]')
    .description('Check payment intent status')
    .action(async (intentId?: string) => {
      process.exitCode = await runIntentStatus(getContext(), intentId)
    })
}

export async function runCli(argv: string[]): Promise<void> {
  const program = createProgram()
  const passphraseForScrub = process.env.TPAY_PASSPHRASE

  try {
    await program.parseAsync(argv, { from: 'user' })
  } catch (error: unknown) {
    const ctx = (program as any)._cliContext as CliContext | undefined
    const format = ctx?.format ?? 'json'

    // Sanitize sensitive data
    let message = sanitizeError(error)
    const seedPhrase = process.env.WALLET_SEED_PHRASE
    if (seedPhrase) message = message.replaceAll(seedPhrase, '[REDACTED]')
    if (passphraseForScrub) message = message.replaceAll(passphraseForScrub, '[REDACTED]')

    // Create sanitized error for wrapping
    const sanitizedError = error instanceof Error
      ? Object.assign(new Error(message), { ...error, message })
      : new Error(message)

    // Wrap in CliError
    const cliError = wrapError(sanitizedError)

    // Output structured error
    outputError(format, cliError)

    // Set exit code
    process.exitCode = cliError.exitCode
  }
}
