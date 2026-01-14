export const FACILITATOR_URL = 'https://facilitator.cronoslabs.org/v2/x402';

export interface NetworkConfig {
  chainId: number;
  rpc: string;
  usdcAddress: string;
  tokenName: string;
  tokenVersion: string;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  'cronos-testnet': {
    chainId: 338,
    rpc: 'https://evm-t3.cronos.org',
    usdcAddress: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0',
    tokenName: 'Bridged USDC (Stargate)',
    tokenVersion: '1',
  },
  'cronos-mainnet': {
    chainId: 25,
    rpc: 'https://evm.cronos.org',
    usdcAddress: '0xf951eC28187D9E5Ca673Da8FE6757E6f0Be5F77C',
    tokenName: 'Bridged USDC (Stargate)',
    tokenVersion: '1',
  },
};

// Alias 'cronos' to 'cronos-mainnet'
NETWORKS['cronos'] = NETWORKS['cronos-mainnet'];

export function getNetworkConfig(network: string): NetworkConfig {
  const normalized = network === 'cronos' ? 'cronos-mainnet' : network;
  const config = NETWORKS[normalized];
  if (!config) {
    throw new Error(`Unknown network: ${network}`);
  }
  return config;
}

// Product pricing (6-decimal base units as strings)
export const PRICING = {
  effect: '50000', // 0.05 USDC.e
  qaNormal: '250000', // 0.25 USDC.e
  qaPriority: '500000', // 0.50 USDC.e
} as const;

export const DEFAULT_TIMEOUT_SECONDS = 300;
