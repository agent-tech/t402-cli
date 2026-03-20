import type { WalletPlugin } from './plugins/wallets/types'
import type { ChainPlugin } from './plugins/chains/types'

// Static map — Bun's --compile can trace these imports at build time
const WALLET_PLUGINS: Record<string, () => Promise<WalletPlugin>> = {
  env: () => import('./plugins/wallets/env').then(m => m.default),
}

const CHAIN_PLUGIN_LOADERS: Array<() => Promise<ChainPlugin>> = [
  () => import('./plugins/chains/solana').then(m => m.default),
]

export async function resolveWalletPlugin(): Promise<WalletPlugin> {
  const provider = process.env.WALLET_PROVIDER ?? 'env'
  const loader = WALLET_PLUGINS[provider]
  if (!loader) throw new Error(`Unknown wallet provider: "${provider}". Available: ${Object.keys(WALLET_PLUGINS).join(', ')}`)
  return loader()
}

export async function resolveChainPlugin(payerChain: string): Promise<ChainPlugin> {
  const plugins = await Promise.all(CHAIN_PLUGIN_LOADERS.map(l => l()))
  const plugin = plugins.find(p => p.chains.includes(payerChain))
  if (!plugin) throw new Error(`No chain plugin found for payer_chain: "${payerChain}"`)
  return plugin
}
