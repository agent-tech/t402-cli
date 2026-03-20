import type { CliContext } from '../types'
import { BaseCommand } from './base'
import { output } from '../output'
import { getConfig } from '../../macros/config.macro' with { type: 'macro' }
import { NetworkError, ValidationError } from '../errors'
import { Connection, PublicKey } from '@solana/web3.js'

const CONFIG = getConfig()
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const LAMPORTS_PER_SOL = 1_000_000_000n
const USDT_DECIMALS = 6

interface BalanceOptions {
  address?: string
}

class BalanceCommand extends BaseCommand {
  async execute(opts: BalanceOptions): Promise<number> {
    const address = this.requireArg(opts.address, 'address')

    let pubkey: PublicKey
    try {
      pubkey = new PublicKey(address)
    } catch {
      throw new ValidationError(`Invalid Solana address: ${address}`)
    }

    const connection = new Connection(CONFIG.solana.rpcUrl)

    try {
      this.ctx.logger.debug('Fetching balances', { address })

      const [solLamports, tokenAccounts] = await Promise.all([
        connection.getBalance(pubkey),
        connection.getParsedTokenAccountsByOwner(pubkey, { mint: USDT_MINT, programId: TOKEN_PROGRAM_ID }),
      ])

      let usdtRaw = 0n
      for (const { account } of tokenAccounts.value) {
        const amount = account.data.parsed?.info?.tokenAmount?.amount
        if (amount) usdtRaw += BigInt(amount)
      }

      output(this.ctx.format, {
        status: 'ok',
        address,
        sol: formatLamports(BigInt(solLamports)),
        usdt: formatToken(usdtRaw, USDT_DECIMALS),
      })
      return 0
    } catch (error) {
      if (error instanceof ValidationError) throw error
      if (error instanceof Error && error.message.includes('Server error')) {
        throw new NetworkError(error.message, error)
      }
      throw error
    }
  }
}

function formatLamports(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL
  const frac = lamports % LAMPORTS_PER_SOL
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(9, '0').replace(/0+$/, '')}`
}

function formatToken(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals)
  const whole = raw / divisor
  const frac = raw % divisor
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

export async function runBalance(ctx: CliContext, opts: BalanceOptions): Promise<number> {
  const command = new BalanceCommand(ctx)
  return command.execute(opts)
}
