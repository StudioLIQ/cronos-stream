import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { useWallet } from '../contexts/WalletContext';
import { useToasts } from './Toast';
import { copyToClipboard } from '../lib/clipboard';

export function TopNav({ children }: { children?: ReactNode }) {
  const { address, isConnected, isConnecting, connect } = useWallet();
  const { addToast } = useToasts();

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
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
