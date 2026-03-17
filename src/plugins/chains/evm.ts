import type { ChainPlugin } from './types'

const evmPlugin: ChainPlugin = {
  name: 'evm',
  chains: ['base', 'bsc', 'base-sepolia'],
  async sign() { throw new Error('not implemented') },
}

export default evmPlugin
