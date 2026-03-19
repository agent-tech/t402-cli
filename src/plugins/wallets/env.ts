import type { WalletPlugin } from './types'

const plugin: WalletPlugin = {
  name: 'env',

  getSeedPhrase(): string {
    const phrase = process.env.WALLET_SEED_PHRASE
    if (!phrase) throw new Error('WALLET_SEED_PHRASE env var is not set')
    return phrase
  },

  getEvmPrivateKey(): string {
    const key = process.env.WALLET_EVM_PRIVATE_KEY
    if (!key) throw new Error('WALLET_EVM_PRIVATE_KEY env var is not set')
    return key
  },
}

export default plugin
