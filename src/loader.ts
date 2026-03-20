import type { WalletPlugin } from './plugins/wallets/types'
import type { ChainPlugin } from './plugins/chains/types'

const CHAIN_PLUGIN_LOADERS: Array<() => Promise<ChainPlugin>> = [
  () => import('./plugins/chains/solana').then(m => m.default),
]

export async function resolveWalletPlugin(): Promise<WalletPlugin> {
  const { default: plugin } = await import('./plugins/wallets/env')
  return plugin
}

export async function resolveChainPlugin(payerChain: string): Promise<ChainPlugin> {
  const plugins = await Promise.all(CHAIN_PLUGIN_LOADERS.map(l => l()))
  const plugin = plugins.find(p => p.chains.includes(payerChain))
  if (!plugin) throw new Error(`No chain plugin found for payer_chain: "${payerChain}"`)
  return plugin
}
