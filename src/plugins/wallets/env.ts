import type { WalletPlugin } from './types'

const plugin: WalletPlugin = {
  name: 'env',

  getEvmPrivateKey(): string {
    const key = process.env.WALLET_EVM_PRIVATE_KEY
    if (!key) throw new Error('WALLET_EVM_PRIVATE_KEY env var is not set')
    return key
  },

  getSolanaSeed(): Uint8Array {
    const hex = process.env.WALLET_SOLANA_SEED
    if (!hex) throw new Error('WALLET_SOLANA_SEED env var is not set')
    const bytes = Buffer.from(hex, 'hex')
    if (bytes.length !== 64) throw new Error('WALLET_SOLANA_SEED must be a 64-byte hex string')
    return new Uint8Array(bytes)
  },
}

export default plugin
