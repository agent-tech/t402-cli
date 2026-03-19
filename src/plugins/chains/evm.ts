import { Wallet, isAddress } from 'ethers'
import type { ChainPlugin } from './types'
import type { PaymentIntentResponse } from '../../types'
import type { WalletPlugin } from '../wallets/types'

function parseChainId(network: string): number {
  // network is CAIP-2 format: 'eip155:8453'
  const parts = network.split(':')
  const id = parseInt(parts[1], 10)
  if (isNaN(id)) throw new Error(`Cannot parse chainId from network: ${network}`)
  return id
}

const evmPlugin: ChainPlugin = {
  name: 'evm',
  chains: ['base', 'bsc', 'base-sepolia'],

  async sign(intent: PaymentIntentResponse, wallet: WalletPlugin): Promise<string> {
    const asset = intent.payment_requirements.asset
    if (!asset) throw new Error('payment_requirements.asset missing from intent')

    const chainId = parseChainId(intent.payment_requirements.network)
    if (!wallet.getEvmPrivateKey) throw new Error('EVM requires WALLET_EVM_PRIVATE_KEY to be set')
    const privateKey = wallet.getEvmPrivateKey()

    // Use ethers Wallet directly from raw private key
    const signer = new Wallet(privateKey)
    const walletAddress = signer.address

    const now = Math.floor(Date.now() / 1000)
    const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
    const nonce = '0x' + Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')

    // Ensure asset is a valid EVM address
    if (!isAddress(asset)) throw new Error(`payment_requirements.asset is not a valid EVM address: ${asset}`)
    const verifyingContract = asset

    const domain = {
      name: intent.payment_requirements.extra.name as string,
      version: intent.payment_requirements.extra.version as string,
      chainId,
      verifyingContract,
    }

    const types = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    }

    const message = {
      from: walletAddress,
      to: intent.payment_requirements.payTo,
      value: intent.payment_requirements.amount,
      validAfter: String(now - 600),
      validBefore: String(now + 600),
      nonce,
    }

    const signature = await signer.signTypedData(domain, types, message)

    const payload = {
      x402Version: 2,
      resource: {
        url: `/api/intents/${intent.intent_id}`,
        description: `Payment of ${intent.sending_amount}`,
        mimeType: 'application/json',
      },
      accepted: {
        scheme: intent.payment_requirements.scheme,
        network: intent.payment_requirements.network,
        amount: intent.payment_requirements.amount,
        asset,
        payTo: intent.payment_requirements.payTo,
        maxTimeoutSeconds: intent.payment_requirements.maxTimeoutSeconds,
        extra: intent.payment_requirements.extra,
      },
      payload: {
        signature,
        authorization: {
          from: walletAddress,
          to: intent.payment_requirements.payTo,
          value: intent.payment_requirements.amount,
          validAfter: message.validAfter,
          validBefore: message.validBefore,
          nonce,
        },
      },
    }

    return Buffer.from(JSON.stringify(payload)).toString('base64')
  },
}

export default evmPlugin
