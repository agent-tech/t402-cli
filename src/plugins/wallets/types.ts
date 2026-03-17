export interface WalletPlugin {
  name: string
  getEvmPrivateKey(): string     // hex private key (0x...)
  getSolanaSeed(): Uint8Array    // 64-byte seed
}
