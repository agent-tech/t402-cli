import type { PaymentIntentResponse, GetPaymentIntentResponse, SendInput } from './types'
import { PaymentStatus, isFailedResponse } from './types'

const REQUEST_TIMEOUT_MS = 30_000

export interface PollResult {
  terminal: boolean
  success: boolean
  data?: GetPaymentIntentResponse
  message?: string
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

export async function createIntent(apiUrl: string, input: SendInput): Promise<PaymentIntentResponse> {
  const body: Record<string, string> = {
    amount: input.amount,
    payer_chain: 'solana',
    recipient: input.to,
  }

  const res = await fetch(`${apiUrl}/api/intents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: withTimeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`)
  }
  return res.json() as Promise<PaymentIntentResponse>
}

export async function submitProof(apiUrl: string, intentId: string, settleProof: string): Promise<void> {
  const res = await fetch(`${apiUrl}/api/intents/${intentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settle_proof: settleProof }),
    signal: withTimeout(REQUEST_TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`)
  }
  // Response is PENDING — ignore it, proceed to polling
}

export function checkExpired(intent: PaymentIntentResponse): boolean {
  return Date.now() > Date.parse(intent.expires_at)
}

export async function pollIntent(
  apiUrl: string,
  intent: PaymentIntentResponse,
  intervalMs: number,
): Promise<PollResult> {
  if (checkExpired(intent)) {
    return { terminal: true, success: false, message: 'Payment expired' }
  }

  try {
    const res = await fetch(`${apiUrl}/api/intents?intent_id=${intent.intent_id}`, {
      signal: withTimeout(REQUEST_TIMEOUT_MS),
    })

    if (!res.ok) {
      // 5xx or other: skip this tick, retry next interval
      return { terminal: false, success: false }
    }

    const data = await res.json() as GetPaymentIntentResponse

    if (data.status === PaymentStatus.BASE_SETTLED) {
      return { terminal: true, success: true, data }
    }
    if (data.status === PaymentStatus.EXPIRED) {
      return { terminal: true, success: false, message: 'Payment expired' }
    }
    if (isFailedResponse(data)) {
      return {
        terminal: true,
        success: false,
        message: `Verification failed: ${data.error_message}`,
      }
    }

    // PENDING, AWAITING_PAYMENT, SOURCE_SETTLED, BASE_SETTLING — continue
    return { terminal: false, success: false }
  } catch {
    // Timeout or network error on GET poll — skip tick, retry
    return { terminal: false, success: false }
  }
}

export async function getIntentStatus(
  apiUrl: string,
  intentId: string,
): Promise<GetPaymentIntentResponse> {
  const res = await fetch(`${apiUrl}/api/intents?intent_id=${intentId}`, {
    signal: withTimeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`)
  }
  return res.json() as Promise<GetPaymentIntentResponse>
}

export async function runPayment(
  apiUrl: string,
  intent: PaymentIntentResponse,
  settleProof: string,
  pollIntervalMs = 2000,
): Promise<PollResult> {
  await submitProof(apiUrl, intent.intent_id, settleProof)

  while (true) {
    if (pollIntervalMs > 0) {
      await new Promise(r => setTimeout(r, pollIntervalMs))
    }
    const result = await pollIntent(apiUrl, intent, 0)
    if (result.terminal) return result
    if (checkExpired(intent)) {
      return { terminal: true, success: false, message: 'Payment expired' }
    }
  }
}
