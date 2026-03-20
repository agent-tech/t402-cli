import type { CliContext, SendOptions } from '../types'
import { BaseCommand } from './base'
import { output } from '../output'
import { resolveWalletPlugin, resolveChainPlugin } from '../../loader'
import { createIntent, runPayment } from '../../payment'
import { getConfig } from '../../macros/config.macro' with { type: 'macro' }
import { isBaseSettledResponse } from '../../types'
import { PaymentError, NetworkError } from '../errors'

const CONFIG = getConfig()
interface SendStdinData {
  to?: string
  amount?: string
}

class SendCommand extends BaseCommand {
  async execute(opts: SendOptions): Promise<number> {
    let { to, amount } = opts

    // Merge with stdin if provided
    if (!to || !amount) {
      const stdinData = await this.readStdinJson<SendStdinData>()
      if (stdinData) {
        to = to ?? stdinData.to
        amount = amount ?? stdinData.amount
      }
    }

    // Validate required args
    this.requireArgs({ to, amount })

    try {
      // Resolve plugins
      this.ctx.logger.debug('Resolving plugins')
      const walletPlugin = await resolveWalletPlugin()

      // Create intent
      this.ctx.logger.debug('Creating payment intent', { to, amount })
      const intent = await createIntent(CONFIG.apiUrl, { to: to!, amount: amount! })
      this.ctx.logger.debug('Intent created', { intent_id: intent.intent_id })

      // Sign transaction
      const chainPlugin = await resolveChainPlugin(intent.payer_chain)
      this.ctx.logger.debug('Signing intent', { chain: intent.payer_chain })
      const settleProof = await chainPlugin.sign(intent, walletPlugin)
      this.ctx.logger.debug('Signed, submitting proof')

      // Submit and poll
      const result = await runPayment(CONFIG.apiUrl, intent, settleProof, 0)

      if (result.success && result.data) {
        if (!isBaseSettledResponse(result.data)) {
          throw new PaymentError('Payment succeeded but response type mismatch', intent.intent_id)
        }

        const settled = result.data
        output(this.ctx.format, {
          status: 'success',
          intent_id: intent.intent_id,
          tx_hash: settled.source_payment.tx_hash,
          explorer_url: settled.source_payment.explorer_url,
        })
        return 0
      }

      // Payment failed
      throw new PaymentError(
        result.message ?? 'Payment failed',
        intent.intent_id
      )
    } catch (error) {
      // Re-throw CLI errors
      if (error instanceof PaymentError || error instanceof NetworkError) {
        throw error
      }
      // Wrap network/fetch errors
      if (error instanceof Error && error.message.includes('Server error')) {
        throw new NetworkError(error.message, error)
      }
      // Re-throw other errors
      throw error
    }
  }
}

export async function runSend(ctx: CliContext, opts: SendOptions): Promise<number> {
  const command = new SendCommand(ctx)
  return command.execute(opts)
}
