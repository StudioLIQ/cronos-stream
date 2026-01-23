import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserProvider, type JsonRpcSigner } from 'ethers';
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

  const syncFromEthereum = useCallback(async () => {
    if (typeof window.ethereum === 'undefined') return;
    try {
      const provider = new BrowserProvider(window.ethereum);
      const accounts = (await provider.send('eth_accounts', [])) as string[];

      if (!accounts || accounts.length === 0) {
        setAddress(null);
        setSigner(null);
        setChainId(null);
        return;
      }

      const nextSigner = await provider.getSigner();
      const nextAddress = await nextSigner.getAddress();
      const network = await provider.getNetwork();

      setAddress(nextAddress);
      setSigner(nextSigner);
      setChainId(Number(network.chainId));
    } catch {
      setAddress(null);
      setSigner(null);
      setChainId(null);
    }
  }, []);

  useEffect(() => {
    syncFromEthereum();
  }, [syncFromEthereum]);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.on || !ethereum?.removeListener) return;

    const handleAccountsChanged = () => {
      syncFromEthereum();
    };

    const handleChainChanged = () => {
      syncFromEthereum();
    };

    ethereum.on('accountsChanged', handleAccountsChanged);
    ethereum.on('chainChanged', handleChainChanged);

    return () => {
      ethereum.removeListener('accountsChanged', handleAccountsChanged);
      ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, [syncFromEthereum]);

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
