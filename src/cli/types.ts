import type { OutputFormat } from './output'
import type { Logger } from '../logger'

// Root options (global flags)
export interface RootOptions {
  verbose?: boolean
  format?: string
}

// Command-specific options
export interface SendOptions {
  to?: string
  amount?: string
}

export interface SetupOptions {
  fromEnv?: string
}

// CLI Context passed to all commands
export interface CliContext {
  format: OutputFormat
  logger: Logger
  rootOptions: RootOptions
}
