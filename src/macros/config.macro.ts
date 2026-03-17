// This file is imported with { type: 'macro' } — runs at bun build time.
// At dev time (bun run), it runs as a normal function reading process.env.
export function getConfig() {
  return {
    apiUrl: process.env.T402_API_URL ?? '',
    solana: {
      rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
      feePayer: process.env.SOLANA_FEE_PAYER ?? '',
    },
  }
}
