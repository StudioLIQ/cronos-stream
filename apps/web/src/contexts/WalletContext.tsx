import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { JsonRpcSigner } from 'ethers';
import { connectWallet, disconnectWallet, getWalletState, switchToCronosTestnet } from '../lib/wallet';

interface WalletContextValue {
  address: string | null;
  signer: JsonRpcSigner | null;
  chainId: number | null;
  isConnected: boolean;
  isConnecting: boolean;
  connect: () => Promise<void>;
  clear: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const initial = getWalletState();
  const [address, setAddress] = useState<string | null>(initial.address);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(initial.signer);
  const [chainId, setChainId] = useState<number | null>(initial.chainId);
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      await switchToCronosTestnet();
      const next = await connectWallet();
      setAddress(next.address);
      setSigner(next.signer);
      setChainId(next.chainId);
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting]);

  const clear = useCallback(() => {
    disconnectWallet();
    setAddress(null);
    setSigner(null);
    setChainId(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      address,
      signer,
      chainId,
      isConnected: Boolean(address && signer),
      isConnecting,
      connect,
      clear,
    }),
    [address, signer, chainId, isConnecting, connect, clear]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
