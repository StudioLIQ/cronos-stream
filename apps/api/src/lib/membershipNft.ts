import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from 'ethers';
import { config } from '../config.js';
import { getNetworkConfig } from '../x402/constants.js';

const MEMBERSHIP_NFT_ABI = ['function mint(address to, uint256 id, uint256 amount, bytes data) external'] as const;

function normalizeNetworkKey(network: string): string {
  return network === 'cronos' ? 'cronos-mainnet' : network;
}

function isHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizePrivateKey(value: string): string {
  if (/^0x[a-fA-F0-9]{64}$/.test(value)) return value;
  if (/^[a-fA-F0-9]{64}$/.test(value)) return `0x${value}`;
  throw new Error('Invalid MEMBERSHIP_NFT_MINTER_PRIVATE_KEY');
}

export interface MembershipNftMintResult {
  txHash: string;
  contractAddress: string;
  tokenId: string;
  amount: string;
}

export function getMembershipNftContractAddress(network: string): string | null {
  const key = normalizeNetworkKey(network);
  const addr =
    key === 'cronos-testnet' || key === 'cronos-mainnet'
      ? config.membershipNft.addressByNetwork[key]
      : null;
  if (!addr) return null;
  return isHexAddress(addr) ? addr : null;
}

export function getMembershipTokenId(slug: string): bigint {
  const digest = keccak256(toUtf8Bytes(`stream402:membership:${slug}`));
  return BigInt(digest);
}

export function isMembershipNftConfigured(network: string): boolean {
  const contractAddress = getMembershipNftContractAddress(network);
  return Boolean(contractAddress && config.membershipNft.minterPrivateKey);
}

export async function mintMembershipNft(params: {
  network: string;
  slug: string;
  toAddress: string;
  amount?: bigint;
}): Promise<MembershipNftMintResult> {
  const { network, slug, toAddress, amount = 1n } = params;

  if (!isHexAddress(toAddress)) {
    throw new Error(`Invalid toAddress: ${toAddress}`);
  }

  const contractAddress = getMembershipNftContractAddress(network);
  if (!contractAddress) {
    throw new Error(`Membership NFT contract not configured for network: ${network}`);
  }

  const privateKeyRaw = config.membershipNft.minterPrivateKey;
  if (!privateKeyRaw) {
    throw new Error('Membership NFT minter key not configured (MEMBERSHIP_NFT_MINTER_PRIVATE_KEY)');
  }

  const privateKey = normalizePrivateKey(privateKeyRaw);
  const networkConfig = getNetworkConfig(network);

  const provider = new JsonRpcProvider(networkConfig.rpc);
  const wallet = new Wallet(privateKey, provider);
  const contract = new Contract(contractAddress, MEMBERSHIP_NFT_ABI, wallet);

  const tokenId = getMembershipTokenId(slug);

  const tx = await contract.mint(toAddress, tokenId, amount, '0x');
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error('Membership NFT mint transaction was not mined');
  }

  return {
    txHash: tx.hash,
    contractAddress,
    tokenId: tokenId.toString(),
    amount: amount.toString(),
  };
}

