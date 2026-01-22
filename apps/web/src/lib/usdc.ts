import { Contract, type JsonRpcSigner } from 'ethers';

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'] as const;

const USDC_ADDRESS_BY_CHAIN_ID: Record<number, string> = {
  338: '0xc01efAaF7C5C61bEbFAeb358E1161b537b8bC0e0', // Cronos Testnet (USDC.e)
  25: '0xf951eC28187D9E5Ca673Da8FE6757E6f0Be5F77C', // Cronos Mainnet (USDC)
};

export function getUsdcAddress(chainId: number | null): string | null {
  if (!chainId) return null;
  return USDC_ADDRESS_BY_CHAIN_ID[chainId] ?? null;
}

export async function fetchUsdcBalanceBaseUnits(
  signer: JsonRpcSigner,
  walletAddress: string,
  chainId: number
): Promise<string> {
  const usdcAddress = getUsdcAddress(chainId);
  if (!usdcAddress) {
    throw new Error(`Unsupported chainId: ${chainId}`);
  }

  const token = new Contract(usdcAddress, ERC20_BALANCE_ABI, signer);
  const balance = (await token.balanceOf(walletAddress)) as bigint;
  return balance.toString();
}

