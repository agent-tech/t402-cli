export interface WalletPlugin {
  name: string
  getSeedPhrase?(): string          // BIP-39 mnemonic (required for Solana)
}
