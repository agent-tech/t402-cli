export enum PaymentStatus {
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PENDING = 'PENDING',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  SOURCE_SETTLED = 'SOURCE_SETTLED',
  BASE_SETTLING = 'BASE_SETTLING',
  BASE_SETTLED = 'BASE_SETTLED',
  EXPIRED = 'EXPIRED',
}

export interface FeeBreakdown {
  platform_fee: string
  platform_fee_percentage: string
  source_chain: string
  source_chain_fee: string
  target_chain: string
  target_chain_fee: string
  total_fee: string
}

export interface PaymentRequirements {
  scheme: string
  network: string
  amount: string
  payTo: string
  maxTimeoutSeconds: number
  asset: string
  extra: {
    name?: string
    version?: string
    feePayer?: string
    decimals?: number
    [key: string]: unknown
  }
}

export interface PaymentIntentResponse {
  intent_id: string
  merchant_recipient: string
  source_recipient?: string
  sending_amount: string
  receiving_amount: string
  payer_chain: string
  status: PaymentStatus
  created_at: string
  expires_at: string
  fee_breakdown: FeeBreakdown
  payment_requirements: PaymentRequirements
}

export interface SourcePayment {
  chain: string
  tx_hash: string
  settle_proof: string
  settled_at: string
  explorer_url: string
}

export type GetPaymentIntentBaseSettledResponse = PaymentIntentResponse & {
  status: PaymentStatus.BASE_SETTLED
  source_payment: SourcePayment
  base_payment: SourcePayment
}

export type GetPaymentIntentFailedResponse = PaymentIntentResponse & {
  status: PaymentStatus.VERIFICATION_FAILED | PaymentStatus.EXPIRED
  error_message: string
}

export type GetPaymentIntentResponse =
  | PaymentIntentResponse
  | GetPaymentIntentBaseSettledResponse
  | GetPaymentIntentFailedResponse

export interface SendInput {
  to: string
  amount: string
  chain: string
  walletProvider?: string
}

export interface CliOutput {
  status: 'success' | 'error' | 'ok'
  [key: string]: unknown
}
