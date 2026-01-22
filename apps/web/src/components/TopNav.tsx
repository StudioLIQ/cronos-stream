import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { useWallet } from '../contexts/WalletContext';
import { useToasts } from './Toast';
import { copyToClipboard } from '../lib/clipboard';
import { formatUsdcAmount } from '../lib/x402';
import { fetchUsdcBalanceBaseUnits, getUsdcAddress } from '../lib/usdc';

export function TopNav({ children }: { children?: ReactNode }) {
  const { address, signer, chainId, isConnected, isConnecting, connect, clear } = useWallet();
  const { addToast } = useToasts();

  const usdcAddress = useMemo(() => getUsdcAddress(chainId), [chainId]);
  const [usdcBalanceBaseUnits, setUsdcBalanceBaseUnits] = useState<string | null>(null);
  const [isUsdcBalanceLoading, setIsUsdcBalanceLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !address || !signer || !chainId || !usdcAddress) {
      setUsdcBalanceBaseUnits(null);
      setIsUsdcBalanceLoading(false);
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      setIsUsdcBalanceLoading(true);
      try {
        const nextBalance = await fetchUsdcBalanceBaseUnits(signer, address, chainId);
        if (cancelled) return;
        setUsdcBalanceBaseUnits(nextBalance);
      } catch {
        if (cancelled) return;
        setUsdcBalanceBaseUnits(null);
      } finally {
        if (cancelled) return;
        setIsUsdcBalanceLoading(false);
      }
    };

    refresh();
    const interval = setInterval(refresh, 15_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isConnected, address, signer, chainId, usdcAddress]);

  const usdcBalanceText = useMemo(() => {
    if (!usdcAddress) return '$— USDC';
    if (usdcBalanceBaseUnits) return `$${formatUsdcAmount(usdcBalanceBaseUnits)} USDC`;
    if (isUsdcBalanceLoading) return '$… USDC';
    return '$— USDC';
  }, [usdcAddress, usdcBalanceBaseUnits, isUsdcBalanceLoading]);

  const handleConnect = async () => {
    try {
      await connect();
      addToast('Wallet connected successfully', 'success');
    } catch (err) {
      addToast((err as Error).message, 'error');
    }
  };

  const handleCopyAddress = async () => {
    if (!address) return;
    const ok = await copyToClipboard(address);
    addToast(ok ? 'Wallet address copied' : 'Failed to copy wallet address', ok ? 'success' : 'error');
  };

  const handleDisconnect = () => {
    clear();
    addToast('Wallet disconnected', 'info');
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand">
          <img
            src="/logo.svg"
            width={20}
            height={20}
            alt=""
            style={{ display: 'block' }}
          />
          Stream402
        </Link>
        {children || <div style={{ flex: 1 }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {!isConnected ? (
            <button
              onClick={handleConnect}
              disabled={isConnecting}
              style={{ background: 'var(--primary)', color: 'var(--primary-text)', border: '1px solid transparent' }}
            >
              {isConnecting ? 'Connecting…' : 'Connect Wallet'}
            </button>
          ) : (
            <>
              <div
                title={usdcAddress ? 'USDC.e balance (refreshes every 15s)' : 'USDC.e balance unavailable on this network'}
                style={{
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  padding: '8px 12px',
                  borderRadius: '999px',
                  fontSize: '13px',
                  color: 'var(--text)',
                  userSelect: 'none',
                }}
              >
                {usdcBalanceText}
              </div>
              <button
                onClick={handleCopyAddress}
                title="Copy wallet address"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  padding: '8px 12px',
                  borderRadius: '999px',
                  fontSize: '13px',
                  color: 'var(--muted)',
                }}
              >
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </button>
              <button
                onClick={handleDisconnect}
                title="Disconnect wallet"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  padding: '8px 12px',
                  borderRadius: '999px',
                  fontSize: '13px',
                  color: 'var(--muted)',
                }}
              >
                Disconnect
              </button>
            </>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
