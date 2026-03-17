import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import type { ChainPlugin } from './types'
import type { PaymentIntentResponse } from '../../types'
import type { WalletPlugin } from '../wallets/types'

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111')

function getAssociatedTokenAddress(wallet: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
  return ata
}

function createSetComputeUnitLimitInstruction(units: number): TransactionInstruction {
  const data = new Uint8Array(5)
  data[0] = 2
  new DataView(data.buffer).setUint32(1, units, true)
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM_ID, data: Buffer.from(data) })
}

function createSetComputeUnitPriceInstruction(microLamports: number): TransactionInstruction {
  const data = new Uint8Array(9)
  data[0] = 3
  new DataView(data.buffer).setBigUint64(1, BigInt(microLamports), true)
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM_ID, data: Buffer.from(data) })
}

function createTransferCheckedInstruction(
  sourceAta: PublicKey,
  mint: PublicKey,
  destAta: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number,
): TransactionInstruction {
  const keys = [
    { pubkey: sourceAta, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: destAta, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false },
  ]
  const data = new Uint8Array(10)
  data[0] = 12
  new DataView(data.buffer).setBigUint64(1, amount, true)
  data[9] = decimals
  return new TransactionInstruction({ keys, programId: TOKEN_PROGRAM_ID, data: Buffer.from(data) })
}

const solanaPlugin: ChainPlugin = {
  name: 'solana',
  chains: ['solana', 'solana-devnet'],

  async sign(intent: PaymentIntentResponse, wallet: WalletPlugin): Promise<string> {
    const reqs = intent.payment_requirements
    const asset = reqs.asset
    if (!asset) throw new Error('payment_requirements.asset missing from intent')

    const feePayer = (reqs.extra.feePayer as string | undefined) ?? process.env.SOLANA_FEE_PAYER ?? ''
    if (!feePayer) throw new Error('No feePayer available — set SOLANA_FEE_PAYER env var or ensure backend provides extra.feePayer')

    const decimals = (reqs.extra.decimals as number | undefined) ?? 6
    const amountAtomic = BigInt(reqs.amount)
    const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'

    // Derive keypair from 64-byte seed (first 32 bytes are the ed25519 private seed)
    const seed = wallet.getSolanaSeed()
    const keypair = Keypair.fromSeed(seed.slice(0, 32))

    const connection = new Connection(rpcUrl, 'confirmed')
    const { blockhash } = await connection.getLatestBlockhash('confirmed')

    const mint = new PublicKey(asset)
    const payerPubkey = keypair.publicKey
    const recipientPubkey = new PublicKey(reqs.payTo)
    const feePayerPubkey = new PublicKey(feePayer)

    const payerAta = getAssociatedTokenAddress(payerPubkey, mint)
    const recipientAta = getAssociatedTokenAddress(recipientPubkey, mint)

    const instructions = [
      createSetComputeUnitLimitInstruction(200_000),
      createSetComputeUnitPriceInstruction(1),
      createTransferCheckedInstruction(payerAta, mint, recipientAta, payerPubkey, amountAtomic, decimals),
    ]

    const messageV0 = new TransactionMessage({
      payerKey: feePayerPubkey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message()

    const tx = new VersionedTransaction(messageV0)
    tx.sign([keypair])

    const serialized = tx.serialize()
    const transactionBase64 = Buffer.from(serialized).toString('base64')

    const payload = {
      x402Version: 2,
      resource: {
        url: `/api/intents/${intent.intent_id}`,
        description: `Payment of ${intent.sending_amount}`,
        mimeType: 'application/json',
      },
      accepted: {
        scheme: reqs.scheme,
        network: reqs.network,
        amount: reqs.amount,
        asset,
        payTo: reqs.payTo,
        maxTimeoutSeconds: reqs.maxTimeoutSeconds,
        extra: { feePayer }, // strip to feePayer ONLY
      },
      payload: { transaction: transactionBase64 },
    }

    return Buffer.from(JSON.stringify(payload)).toString('base64')
  },
}

export default solanaPlugin
