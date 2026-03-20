import type { CliContext } from '../types'
import { BaseCommand } from './base'
import { output } from '../output'
import { getIntentStatus } from '../../payment'
import { getConfig } from '../../macros/config.macro' with { type: 'macro' }
import { isBaseSettledResponse, hasErrorMessage } from '../../types'
import { NetworkError } from '../errors'

const CONFIG = getConfig()

interface IntentStatusStdinData {
  intent_id?: string
}

class IntentStatusCommand extends BaseCommand {
  async execute(intentId?: string): Promise<number> {
    let resolvedId = intentId

    // Try reading from stdin if not provided
    if (!resolvedId) {
      const stdinData = await this.readStdinJson<IntentStatusStdinData>()
      if (stdinData) {
        resolvedId = stdinData.intent_id
      }
    }

    // Validate
    resolvedId = this.requireArg(resolvedId, 'intent_id')

    try {
      this.ctx.logger.debug('Fetching intent status', { intentId: resolvedId })
      const data = await getIntentStatus(CONFIG.apiUrl, resolvedId)

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

      // Use type guards instead of 'in' checks
      if (isBaseSettledResponse(data)) {
        response.tx_hash = data.source_payment.tx_hash
        response.explorer_url = data.source_payment.explorer_url
      }

      if (hasErrorMessage(data)) {
        response.error_message = data.error_message
      }

      output(this.ctx.format, response)
      return 0
    } catch (error) {
      if (error instanceof Error && error.message.includes('Server error')) {
        throw new NetworkError(error.message, error)
      }
      throw error
    }
  }
}

export async function runIntentStatus(ctx: CliContext, intentId?: string): Promise<number> {
  const command = new IntentStatusCommand(ctx)
  return command.execute(intentId)
}
