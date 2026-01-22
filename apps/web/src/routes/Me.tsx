import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopNav } from '../components/TopNav';
import { useWallet } from '../contexts/WalletContext';
import { fetchProfileSupports, fetchPublicReceipt, type PaymentReceipt, type ProfileSupportItem } from '../lib/api';
import { formatUsdcAmount } from '../lib/x402';
import { copyToClipboard } from '../lib/clipboard';
import { useToasts } from '../components/Toast';

type SupportFilter = 'all' | 'effect' | 'qa' | 'donation' | 'membership';

function formatSupportKind(kind: string | null): string {
  if (!kind) return 'support';
  if (kind === 'qa') return 'qa';
  return kind;
}

function getSupportSecondaryLabel(item: ProfileSupportItem): string | null {
  if (item.kind === 'membership' && item.membershipPlanName) return item.membershipPlanName;
  if (item.kind === 'effect' && item.actionKey) return item.actionKey;
  return null;
}

export default function Me() {
  const { address, isConnected } = useWallet();
  const { addToast } = useToasts();

  const [filter, setFilter] = useState<SupportFilter>('all');
  const [items, setItems] = useState<ProfileSupportItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [expandedReceipt, setExpandedReceipt] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<PaymentReceipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const kindParam = useMemo(() => {
    if (filter === 'all') return undefined;
    return filter;
  }, [filter]);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setExpandedReceipt(null);
    setReceiptData(null);
    setReceiptError(null);
    try {
      const data = await fetchProfileSupports(address, { limit: 20, kind: kindParam });
      setItems(data.items);
      setNextCursor(data.nextCursor);
    } catch (err) {
      addToast((err as Error).message, 'error');
      setItems([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [address, addToast, kindParam]);

  const loadMore = useCallback(async () => {
    if (!address || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchProfileSupports(address, { limit: 20, cursor: nextCursor, kind: kindParam });
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      addToast((err as Error).message, 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [address, addToast, kindParam, loadingMore, nextCursor]);

  useEffect(() => {
    if (!isConnected || !address) return;
    refresh();
  }, [isConnected, address, refresh]);

  const handleViewReceipt = async (paymentId: string) => {
    if (!address) return;

    if (expandedReceipt === paymentId) {
      setExpandedReceipt(null);
      setReceiptData(null);
      setReceiptError(null);
      return;
    }

    const payment = items.find((i) => i.paymentId === paymentId);
    if (!payment) return;

    setExpandedReceipt(paymentId);
    setReceiptLoading(true);
    setReceiptError(null);
    setReceiptData(null);

    try {
      const data = await fetchPublicReceipt(payment.channelSlug, paymentId, address);
      setReceiptData(data);
    } catch (err) {
      setReceiptError((err as Error).message);
    } finally {
      setReceiptLoading(false);
    }
  };

  const handleCopyTxHash = async (txHash: string) => {
    const ok = await copyToClipboard(txHash);
    addToast(ok ? 'Transaction hash copied to clipboard' : 'Failed to copy to clipboard', ok ? 'success' : 'error');
  };

  return (
    <div>
      <TopNav />
      <div className="container">
        <header style={{ marginBottom: '24px' }}>
          <h1>My Page</h1>
          <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Your supports and memberships across channels.</p>
        </header>

        {!isConnected && (
          <div className="card">
            <p style={{ color: 'var(--muted)' }}>Connect your wallet to view your history.</p>
          </div>
        )}

        {isConnected && (
          <>
            <div className="card" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>History</div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                    Showing {filter === 'all' ? 'all supports' : filter}.
                  </div>
                </div>
                <select value={filter} onChange={(e) => setFilter(e.target.value as SupportFilter)}>
                  <option value="all">All</option>
                  <option value="donation">Donations</option>
                  <option value="qa">Questions</option>
                  <option value="effect">Effects</option>
                  <option value="membership">Memberships</option>
                </select>
              </div>
            </div>

            <div className="card">
              {loading && <p style={{ color: 'var(--muted)' }}>Loading...</p>}

              {!loading && items.length === 0 && (
                <p style={{ color: 'var(--muted)', fontSize: '14px' }}>No supports yet.</p>
              )}

              {!loading && items.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {items.map((support) => {
                    const secondaryLabel = getSupportSecondaryLabel(support);

                    return (
                    <div key={support.paymentId}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px',
                          background: 'var(--panel-2)',
                          borderRadius: expandedReceipt === support.paymentId ? '6px 6px 0 0' : '6px',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                            <Link to={`/v/${support.channelSlug}`} style={{ color: 'var(--text)', fontWeight: 600, minWidth: 0 }}>
                              <span style={{ display: 'inline-block', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {support.channelDisplayName}
                              </span>
                            </Link>
                            <span
                              style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                color: 'var(--primary-text)',
                                background:
                                  support.kind === 'donation'
                                    ? '#f2da00'
                                    : support.kind === 'qa'
                                    ? '#5cbffb'
                                    : support.kind === 'membership'
                                    ? 'var(--accent)'
                                    : '#9da5b6',
                              }}
                            >
                              {formatSupportKind(support.kind)}
                            </span>
                          </div>

                          <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--muted)' }}>
                            {secondaryLabel ? <span>{secondaryLabel}</span> : null}
                            {support.timestamp ? (
                              <span style={{ marginLeft: secondaryLabel ? '8px' : 0 }}>
                                {new Date(support.timestamp * 1000).toLocaleString()}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          <span style={{ fontWeight: 'bold', color: 'var(--accent)' }}>
                            ${formatUsdcAmount(support.value)}
                          </span>
                          <button
                            onClick={() => handleViewReceipt(support.paymentId)}
                            style={{
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              color: 'var(--muted)',
                              padding: '2px 8px',
                              fontSize: '11px',
                              cursor: 'pointer',
                            }}
                          >
                            {expandedReceipt === support.paymentId ? 'Hide' : 'Details'}
                          </button>
                        </div>
                      </div>

                      {expandedReceipt === support.paymentId && (
                        <div
                          style={{
                            padding: '12px',
                            background: 'var(--panel)',
                            borderRadius: '0 0 6px 6px',
                            borderTop: '1px solid var(--border)',
                            fontSize: '12px',
                          }}
                        >
                          {receiptLoading && <p style={{ color: 'var(--muted)' }}>Loading receipt...</p>}
                          {receiptError && <p style={{ color: 'var(--danger)' }}>{receiptError}</p>}
                          {receiptData && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--muted)' }}>Status:</span>
                                <span style={{ color: receiptData.status === 'settled' ? 'var(--accent)' : 'var(--text)' }}>
                                  {receiptData.status}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--muted)' }}>Channel:</span>
                                <span>
                                  <Link to={`/v/${support.channelSlug}`} style={{ color: 'var(--accent-text)' }}>
                                    {support.channelSlug}
                                  </Link>
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--muted)' }}>Kind:</span>
                                <span>{receiptData.kind || '—'}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--muted)' }}>Amount:</span>
                                <span>${formatUsdcAmount(receiptData.value)} USDC</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--muted)' }}>From:</span>
                                <span style={{ fontFamily: 'monospace' }}>{receiptData.fromAddress.slice(0, 10)}...</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--muted)' }}>To:</span>
                                <span style={{ fontFamily: 'monospace' }}>{receiptData.toAddress.slice(0, 10)}...</span>
                              </div>
                              {receiptData.txHash && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ color: 'var(--muted)' }}>Transaction:</span>
                                  <span>
                                    <a
                                      href={`https://explorer.cronos.org/testnet/tx/${receiptData.txHash}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: 'var(--accent-text)' }}
                                    >
                                      {receiptData.txHash.slice(0, 10)}...
                                    </a>
                                    <button
                                      onClick={() => handleCopyTxHash(receiptData.txHash)}
                                      style={{
                                        marginLeft: '8px',
                                        background: 'transparent',
                                        color: 'var(--muted)',
                                        border: '1px solid var(--border)',
                                        cursor: 'pointer',
                                        fontSize: '11px',
                                        padding: '2px 8px',
                                      }}
                                    >
                                      Copy
                                    </button>
                                  </span>
                                </div>
                              )}
                              {receiptData.actionKey && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: 'var(--muted)' }}>Action:</span>
                                  <span>{receiptData.actionKey}</span>
                                </div>
                              )}
                              {receiptData.timestamp && (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span style={{ color: 'var(--muted)' }}>Time:</span>
                                  <span>{new Date(receiptData.timestamp * 1000).toLocaleString()}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                  })}
                </div>
              )}

              {!loading && nextCursor && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{
                    marginTop: '12px',
                    background: 'transparent',
                    color: 'var(--accent-text)',
                    border: '1px solid var(--border)',
                    fontSize: '12px',
                    width: '100%',
                  }}
                >
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
