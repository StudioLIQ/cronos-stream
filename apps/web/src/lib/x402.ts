import { JsonRpcSigner, randomBytes, hexlify } from 'ethers';
import type { PaymentRequirements } from './api';
import { formatWalletSignatureError } from './walletErrors';

const NETWORKS: Record<string, { chainId: number; tokenName: string; tokenVersion: string }> = {
  'cronos-testnet': {
    chainId: 338,
    tokenName: 'Bridged USDC (Stargate)',
    tokenVersion: '1',
  },
  'cronos-mainnet': {
    chainId: 25,
    tokenName: 'Bridged USDC (Stargate)',
    tokenVersion: '1',
  },
};

// UTF-8 safe base64 encoding
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export interface PaymentHeader {
  x402Version: 1;
  scheme: 'exact';
  network: string;
  payload: {
    from: string;
    to: string;
    value: string;
    validAfter: number;
    validBefore: number;
    nonce: string;
    signature: string;
    asset: string;
  };
}

export async function createPaymentHeader(
  signer: JsonRpcSigner,
  requirements: PaymentRequirements
): Promise<string> {
  const networkConfig = NETWORKS[requirements.network];
  if (!networkConfig) {
    throw new Error(`Unknown network: ${requirements.network}`);
  }

  const from = await signer.getAddress();
  const to = requirements.payTo;
  const value = requirements.maxAmountRequired;
  const asset = requirements.asset;

  // Generate random nonce (32 bytes)
  const nonceBytes = randomBytes(32);
  const nonce = hexlify(nonceBytes);

  // Valid time window
  const validAfter = 0;
  const validBefore = Math.floor(Date.now() / 1000) + requirements.maxTimeoutSeconds;

  // EIP-712 domain
  const domain = {
    name: networkConfig.tokenName,
    version: networkConfig.tokenVersion,
    chainId: networkConfig.chainId,
    verifyingContract: asset,
  };

  // EIP-712 types for TransferWithAuthorization
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };

  // Message to sign
  const message = {
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
  };

  // Sign the typed data
  let signature: string;
  try {
    signature = await signer.signTypedData(domain, types, message);
  } catch (err) {
    throw new Error(formatWalletSignatureError(err));
  }

  // Build payment header
  const paymentHeader: PaymentHeader = {
    x402Version: 1,
    scheme: 'exact',
    network: requirements.network,
    payload: {
      from,
      to,
      value,
      validAfter,
      validBefore,
      nonce,
      signature,
      asset,
    },
  };

  // Encode to base64
  const json = JSON.stringify(paymentHeader);
  return utf8ToBase64(json);
}

export function formatUsdcAmount(baseUnits: string): string {
  const value = BigInt(baseUnits);
  const dollars = value / 1_000_000n;
  const cents = value % 1_000_000n;
  const centsStr = cents.toString().padStart(6, '0').slice(0, 2);
  return `${dollars}.${centsStr}`;
}
