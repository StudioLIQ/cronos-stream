import { BrowserProvider, JsonRpcSigner } from 'ethers';

interface WalletState {
  address: string | null;
  signer: JsonRpcSigner | null;
  chainId: number | null;
}

let state: WalletState = {
  address: null,
  signer: null,
  chainId: null,
};

export async function connectWallet(): Promise<WalletState> {
  if (typeof window.ethereum === 'undefined') {
    throw new Error('MetaMask or compatible wallet not found');
  }

  const provider = new BrowserProvider(window.ethereum);
  const accounts = await provider.send('eth_requestAccounts', []);

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts found');
  }

  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const network = await provider.getNetwork();

  state = {
    address,
    signer,
    chainId: Number(network.chainId),
  };

  return state;
}

export function getWalletState(): WalletState {
  return state;
}

export function disconnectWallet(): void {
  state = {
    address: null,
    signer: null,
    chainId: null,
  };
}

export function getSigner(): JsonRpcSigner | null {
  return state.signer;
}

export function getAddress(): string | null {
  return state.address;
}

export function isConnected(): boolean {
  return state.signer !== null;
}

// Switch to Cronos testnet
export async function switchToCronosTestnet(): Promise<void> {
  if (typeof window.ethereum === 'undefined') {
    throw new Error('MetaMask or compatible wallet not found');
  }

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x152' }], // 338 in hex
    });
  } catch (error: unknown) {
    const err = error as { code?: number };
    // Chain not added, add it
    if (err.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: '0x152',
            chainName: 'Cronos Testnet',
            nativeCurrency: {
              name: 'TCRO',
              symbol: 'TCRO',
              decimals: 18,
            },
            rpcUrls: ['https://evm-t3.cronos.org'],
            blockExplorerUrls: ['https://explorer.cronos.org/testnet'],
          },
        ],
      });
    } else {
      throw error;
    }
  }
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}
