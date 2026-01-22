import { Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';
import { useWallet } from '../contexts/WalletContext';
import { useToasts } from './Toast';
import { copyToClipboard } from '../lib/clipboard';
import { formatUsdcAmount } from '../lib/x402';
import { fetchGlobalProfile, fetchGlobalProfileNonce, updateGlobalProfile } from '../lib/api';
import { fetchUsdcBalanceBaseUnits, getUsdcAddress } from '../lib/usdc';
import { formatWalletSignatureError } from '../lib/walletErrors';

export function TopNav({ children }: { children?: ReactNode }) {
  const { address, signer, chainId, isConnected, isConnecting, connect, clear } = useWallet();
  const { addToast } = useToasts();

  const usdcAddress = useMemo(() => getUsdcAddress(chainId), [chainId]);
  const [usdcBalanceBaseUnits, setUsdcBalanceBaseUnits] = useState<string | null>(null);
  const [isUsdcBalanceLoading, setIsUsdcBalanceLoading] = useState(false);

  const [globalDisplayName, setGlobalDisplayName] = useState<string | null>(null);
  const [isGlobalProfileLoading, setIsGlobalProfileLoading] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [isNicknameSaving, setIsNicknameSaving] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);

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

  useEffect(() => {
    if (!isConnected || !address) {
      setGlobalDisplayName(null);
      setNicknameInput('');
      setIsGlobalProfileLoading(false);
      setIsProfileMenuOpen(false);
      return;
    }

    let cancelled = false;
    setIsGlobalProfileLoading(true);

    fetchGlobalProfile(address)
      .then((profile) => {
        if (cancelled) return;
        setGlobalDisplayName(profile.displayName);
        setNicknameInput(profile.displayName || '');
      })
      .catch(() => {
        if (cancelled) return;
        setGlobalDisplayName(null);
        setNicknameInput('');
      })
      .finally(() => {
        if (cancelled) return;
        setIsGlobalProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isConnected, address]);

  useEffect(() => {
    if (!isProfileMenuOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (profileMenuRef.current?.contains(target)) return;
      if (profileButtonRef.current?.contains(target)) return;
      setIsProfileMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsProfileMenuOpen(false);
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isProfileMenuOpen]);

  const usdcBalanceText = useMemo(() => {
    if (!usdcAddress) return '$— USDC';
    if (usdcBalanceBaseUnits) return `$${formatUsdcAmount(usdcBalanceBaseUnits)} USDC`;
    if (isUsdcBalanceLoading) return '$… USDC';
    return '$— USDC';
  }, [usdcAddress, usdcBalanceBaseUnits, isUsdcBalanceLoading]);

  const walletButtonLabel = useMemo(() => {
    if (!address) return '';
    return globalDisplayName || `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, [address, globalDisplayName]);

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

  const handleSaveNickname = async () => {
    if (!address) return;

    const displayName = nicknameInput.trim();
    if (!displayName) {
      addToast('Please enter a nickname.', 'warning');
      return;
    }

    setIsNicknameSaving(true);

    try {
      const nonceData = await fetchGlobalProfileNonce(address);
      if (!signer) throw new Error('Wallet not connected');

      const message = `Stream402 Global Profile Update

Address: ${address.toLowerCase()}
Display Name: ${displayName}
Scope: global
Nonce: ${nonceData.nonce}
Issued At: ${nonceData.issuedAt}
Expires At: ${nonceData.expiresAt}`;

      const signature = await signer.signMessage(message);

      await updateGlobalProfile(address, displayName, nonceData.nonce, nonceData.issuedAt, nonceData.expiresAt, signature);

      const profile = await fetchGlobalProfile(address);
      setGlobalDisplayName(profile.displayName);
      setNicknameInput(profile.displayName || '');

      addToast('Nickname updated', 'success');
      setIsProfileMenuOpen(false);
    } catch (err) {
      addToast(formatWalletSignatureError(err), 'error');
    } finally {
      setIsNicknameSaving(false);
    }
  };

  const handleDisconnect = () => {
    setIsProfileMenuOpen(false);
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
	              <div style={{ position: 'relative' }}>
	                <button
	                  ref={profileButtonRef}
	                  onClick={() => setIsProfileMenuOpen((prev) => !prev)}
	                  title="Nickname & wallet"
	                  style={{
	                    background: 'transparent',
	                    border: '1px solid var(--border)',
	                    padding: '8px 12px',
	                    borderRadius: '999px',
	                    fontSize: '13px',
	                    color: 'var(--muted)',
	                  }}
	                >
	                  {walletButtonLabel} ▾
	                </button>
	                {isProfileMenuOpen && (
	                  <div
	                    ref={profileMenuRef}
	                    className="card"
	                    style={{
	                      position: 'absolute',
	                      top: 'calc(100% + 8px)',
	                      right: 0,
	                      width: '320px',
	                      padding: '12px',
	                      zIndex: 10000,
	                    }}
	                  >
	                    <div style={{ fontWeight: 600, marginBottom: '8px' }}>Nickname</div>
	                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--muted)', lineHeight: 1.4 }}>
	                      Nickname changes require a wallet signature (no payment).
	                    </p>

	                    <div style={{ marginTop: '12px' }}>
	                      <label style={{ display: 'block', marginBottom: '4px', color: 'var(--muted)', fontSize: '13px' }}>
	                        Global Nickname
	                      </label>
	                      <input
	                        type="text"
	                        value={nicknameInput}
	                        onChange={(e) => setNicknameInput(e.target.value)}
	                        placeholder="2-20 characters"
	                        maxLength={20}
	                        style={{ width: '100%' }}
	                        disabled={isGlobalProfileLoading || isNicknameSaving}
	                      />
	                    </div>

	                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
	                      <button
	                        onClick={handleSaveNickname}
	                        disabled={isGlobalProfileLoading || isNicknameSaving || !nicknameInput.trim()}
	                        style={{ background: 'var(--primary)', color: 'var(--primary-text)', flex: 1 }}
	                      >
	                        {isNicknameSaving ? 'Signing...' : 'Save'}
	                      </button>
	                      <button
	                        onClick={handleCopyAddress}
	                        style={{
	                          background: 'transparent',
	                          border: '1px solid var(--border)',
	                          color: 'var(--muted)',
	                          flex: 1,
	                        }}
	                      >
	                        Copy Address
	                      </button>
	                    </div>

	                    {address && (
	                      <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--muted)', fontFamily: 'monospace' }}>
	                        {address}
	                      </div>
	                    )}
	                  </div>
	                )}
	              </div>
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
