import type { PaymentIntentResponse } from '../../types'
import type { WalletPlugin } from '../wallets/types'

export interface ChainPlugin {
  name: string
  chains: string[]
  sign(intent: PaymentIntentResponse, wallet: WalletPlugin): Promise<string>
  // returns base64-encoded x402 v2 payload string
}
