import type { ChainPlugin } from './types'

const solanaPlugin: ChainPlugin = {
  name: 'solana',
  chains: ['solana', 'solana-devnet'],
  async sign() { throw new Error('not implemented') },
}

export default solanaPlugin
