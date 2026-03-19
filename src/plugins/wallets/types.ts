export interface WalletPlugin {
  name: string
  getSeedPhrase?(): string          // BIP-39 mnemonic (required for Solana)
  getEvmPrivateKey?(): string       // hex private key (required for EVM)
}
