// Base CLI error class
export abstract class CliError extends Error {
  abstract readonly exitCode: number
  abstract readonly errorType: string

  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = this.constructor.name
    Error.captureStackTrace(this, this.constructor)
  }

  toJSON() {
    const result: Record<string, unknown> = {
      status: 'error',
      error_type: this.errorType,
      message: this.message,
    }
    if (this.cause) {
      result.cause = String(this.cause)
    }
    return result
  }
}

// Validation errors (exit code 1)
export class ValidationError extends CliError {
  readonly exitCode = 1
  readonly errorType = 'validation_error'

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

// Runtime errors (exit code 2)
export class RuntimeError extends CliError {
  readonly exitCode = 2
  readonly errorType = 'runtime_error'

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

// Configuration errors (exit code 3)
export class ConfigurationError extends CliError {
  readonly exitCode = 3
  readonly errorType = 'configuration_error'

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

// Network/API errors (exit code 4)
export class NetworkError extends CliError {
  readonly exitCode = 4
  readonly errorType = 'network_error'

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

// Payment-specific errors (exit code 5)
export class PaymentError extends CliError {
  readonly exitCode = 5
  readonly errorType = 'payment_error'

  constructor(
    message: string,
    public readonly intentId?: string,
    cause?: unknown
  ) {
    super(message, cause)
  }

  toJSON() {
    return {
      ...super.toJSON(),
      ...(this.intentId && { intent_id: this.intentId }),
    }
  }
}

// Helper to wrap unknown errors
export function wrapError(error: unknown, defaultMessage = 'Unknown error'): CliError {
  if (error instanceof CliError) {
    return error
  }

  if (error instanceof Error) {
    return new RuntimeError(error.message, error)
  }

  return new RuntimeError(defaultMessage, error)
}
