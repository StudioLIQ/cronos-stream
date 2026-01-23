import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TopNav } from '../components/TopNav';
import { EmptyState } from '../components/EmptyState';
import { useToasts } from '../components/Toast';
import { API_BASE } from '../lib/config';
import { copyToClipboard } from '../lib/clipboard';
import { formatUsdcAmount } from '../lib/x402';
import { fetchChannel, type Channel } from '../lib/api';
import {
  buildDashboardAuthHeaders,
  clearStoredDashboardToken,
  getStoredDashboardToken,
  storeDashboardToken,
} from '../lib/dashboardAuth';

type SupportKind = 'all' | 'effect' | 'qa' | 'donation' | 'membership';

type SupportItem = {
  paymentId: string;
  kind: string | null;
  value: string;
  txHash: string | null;
  timestamp: number | null;
  actionKey: string | null;
  qaId: string | null;
  fromAddress: string;
  displayName: string | null;
};

type SupportsResponse = {
  items: SupportItem[];
  nextCursor: string | null;
};

function formatAddress(address: string): string {
  if (!address) return '—';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function getExplorerTxUrl(network: string | null | undefined, txHash: string): string {
  const isTestnet = (network || '').includes('testnet');
  const base = isTestnet ? 'https://explorer.cronos.org/testnet/tx/' : 'https://explorer.cronos.org/tx/';
  return `${base}${encodeURIComponent(txHash)}`;
}

function normalizeFromAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

export default function ChannelSupports() {
  const { slug } = useParams<{ slug: string }>();
  const { addToast } = useToasts();

  const [dashboardToken, setDashboardToken] = useState<string | null>(() => getStoredDashboardToken());
  const [tokenInput, setTokenInput] = useState(() => getStoredDashboardToken() ?? '');

  const [channel, setChannel] = useState<Channel | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);

  const [kindInput, setKindInput] = useState<SupportKind>('all');
  const [fromInput, setFromInput] = useState('');
  const [kind, setKind] = useState<SupportKind>('all');
  const [fromAddress, setFromAddress] = useState<string | null>(null);

  const [items, setItems] = useState<SupportItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setChannel(null);
    setChannelError(null);

    fetchChannel(slug)
      .then((ch) => setChannel(ch))
      .catch((err) => setChannelError((err as Error).message));
  }, [slug]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (kind !== 'all') params.set('kind', kind);
    if (fromAddress) params.set('from', fromAddress);
    return params.toString();
  }, [kind, fromAddress]);

  const refresh = useCallback(async () => {
    if (!slug || !dashboardToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/channels/${encodeURIComponent(slug)}/supports?${queryString}`, {
        headers: buildDashboardAuthHeaders(dashboardToken),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Dashboard token is missing or invalid.');
        }
        throw new Error(`Failed to load supports (${res.status})`);
      }
      const data = (await res.json()) as SupportsResponse;
      setItems(data.items);
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError((err as Error).message);
      setItems([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [slug, dashboardToken, queryString]);

  const loadMore = useCallback(async () => {
    if (!slug || !dashboardToken || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const cursorParams = new URLSearchParams(queryString);
      cursorParams.set('cursor', nextCursor);

      const res = await fetch(`${API_BASE}/channels/${encodeURIComponent(slug)}/supports?${cursorParams.toString()}`, {
        headers: buildDashboardAuthHeaders(dashboardToken),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error('Dashboard token is missing or invalid.');
        }
        throw new Error(`Failed to load supports (${res.status})`);
      }
      const data = (await res.json()) as SupportsResponse;
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [slug, dashboardToken, nextCursor, loadingMore, queryString]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSaveToken = () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      addToast('Enter a dashboard token', 'warning');
      return;
    }
    storeDashboardToken(trimmed);
    setDashboardToken(trimmed);
    addToast('Dashboard token saved', 'success');
  };

  const handleClearToken = () => {
    clearStoredDashboardToken();
    setDashboardToken(null);
    setTokenInput('');
    setItems([]);
    setNextCursor(null);
    setError(null);
    addToast('Dashboard token cleared', 'info');
  };

  const handleApplyFilters = () => {
    setKind(kindInput);
    setFromAddress(normalizeFromAddress(fromInput));
  };

  const handleCopy = async (value: string, label: string) => {
    const ok = await copyToClipboard(value);
    addToast(ok ? `${label} copied` : `Failed to copy ${label.toLowerCase()}`, ok ? 'success' : 'error');
  };

  return (
    <div>
      <TopNav />
      <main className="container" style={{ paddingTop: '20px', paddingBottom: '48px' }}>
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0 }}>
              {channel ? channel.displayName : 'Supports'}
            </h1>
            <div style={{ marginTop: '6px', color: 'var(--muted)', fontSize: '13px' }}>
              {slug ? (
                <>
                  Channel: <code style={{ color: 'var(--accent-text)' }}>{slug}</code>
                  {channel?.network ? ` · ${channel.network}` : ''}
                </>
              ) : (
                'Channel not selected'
              )}
            </div>
          </div>
	          {slug && (
	            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
	              <Link to="/dashboard" style={{ color: 'var(--accent-text)', fontSize: '13px' }}>Dashboard</Link>
	              <Link to={`/v/${encodeURIComponent(slug)}`} style={{ color: 'var(--accent-text)', fontSize: '13px' }}>Viewer</Link>
	              <Link to={`/o/${encodeURIComponent(slug)}`} style={{ color: 'var(--accent-text)', fontSize: '13px' }}>Overlay</Link>
	            </div>
	          )}
        </div>

        <div className="card" style={{ marginBottom: '16px' }}>
          <div style={{ fontWeight: 800 }}>Dashboard token</div>
          <div style={{ marginTop: '6px', color: 'var(--muted)', fontSize: '13px' }}>
            Required for streamer/admin support history. Stored in your browser (localStorage). Default: <code>demo-token</code>
          </div>
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="demo-token"
              style={{
                flex: 1,
                minWidth: '220px',
                padding: '10px 12px',
                background: 'var(--panel-2)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text)',
              }}
            />
            <button
              onClick={handleSaveToken}
              style={{ background: 'var(--primary)', color: 'var(--primary-text)' }}
            >
              Save
            </button>
            <button
              onClick={handleClearToken}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)' }}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '180px' }}>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Kind</span>
              <select
                value={kindInput}
                onChange={(e) => setKindInput(e.target.value as SupportKind)}
                style={{
                  padding: '10px 12px',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: 'var(--text)',
                }}
              >
                <option value="all">all</option>
                <option value="donation">donation</option>
                <option value="membership">membership</option>
                <option value="qa">qa</option>
                <option value="effect">effect</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '260px' }}>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>From (optional)</span>
              <input
                type="text"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                placeholder="0x…"
                style={{
                  padding: '10px 12px',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  color: 'var(--text)',
                }}
              />
            </label>
            <button
              onClick={handleApplyFilters}
              style={{ background: 'var(--primary)', color: 'var(--primary-text)' }}
            >
              Apply
            </button>
            <button
              onClick={refresh}
              disabled={loading || !dashboardToken || !slug}
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)' }}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {channelError && (
          <div className="card" style={{ borderColor: 'rgba(255, 92, 92, 0.35)', marginBottom: '16px' }}>
            <div style={{ color: 'var(--danger)', fontWeight: 700 }}>Channel load failed</div>
            <div style={{ marginTop: '6px', color: 'var(--muted)', fontSize: '13px' }}>{channelError}</div>
          </div>
        )}

        {error && (
          <div className="card" style={{ borderColor: 'rgba(255, 92, 92, 0.35)', marginBottom: '16px' }}>
            <div style={{ color: 'var(--danger)', fontWeight: 700 }}>Failed to load</div>
            <div style={{ marginTop: '6px', color: 'var(--muted)', fontSize: '13px' }}>{error}</div>
          </div>
        )}

        {!dashboardToken && (
          <div className="card">
            <EmptyState
              icon="🔐"
              title="Dashboard token required"
              description="Enter a dashboard token above to view this channel’s support history."
            />
          </div>
        )}

        {dashboardToken && slug && !loading && items.length === 0 && !error && (
          <div className="card">
            <EmptyState icon="📭" title="No supports found" description="No settled supports match the current filters." />
          </div>
        )}

        {dashboardToken && slug && items.length > 0 && (
          <div className="card">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '980px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: '12px' }}>
                    <th style={{ padding: '10px 12px' }}>Time</th>
                    <th style={{ padding: '10px 12px' }}>Kind</th>
                    <th style={{ padding: '10px 12px' }}>From</th>
                    <th style={{ padding: '10px 12px' }}>Display</th>
                    <th style={{ padding: '10px 12px' }}>Value</th>
                    <th style={{ padding: '10px 12px' }}>Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.paymentId} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {it.timestamp ? new Date(it.timestamp * 1000).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontWeight: 800 }}>{it.kind || 'support'}</span>
                          {(it.actionKey || it.qaId) && (
                            <span style={{ color: 'var(--muted)', fontSize: '12px' }}>
                              {it.actionKey ? `action: ${it.actionKey}` : it.qaId ? `qa: ${it.qaId.slice(0, 8)}…` : null}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <button
                          onClick={() => handleCopy(it.fromAddress, 'Address')}
                          title="Copy address"
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            padding: '6px 10px',
                            borderRadius: '999px',
                            fontSize: '12px',
                            color: 'var(--muted)',
                          }}
                        >
                          {formatAddress(it.fromAddress)} Copy
                        </button>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <span style={{ color: it.displayName ? 'var(--text)' : 'var(--muted)' }}>
                          {it.displayName || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', fontWeight: 800 }}>${formatUsdcAmount(it.value)}</td>
                      <td style={{ padding: '12px' }}>
                        {it.txHash ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <a
                              href={getExplorerTxUrl(channel?.network, it.txHash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'var(--accent-text)' }}
                            >
                              {it.txHash.slice(0, 10)}…
                            </a>
                            <button
                              onClick={() => handleCopy(it.txHash as string, 'Tx hash')}
                              style={{
                                background: 'transparent',
                                border: '1px solid var(--border)',
                                padding: '6px 10px',
                                borderRadius: '999px',
                                fontSize: '12px',
                                color: 'var(--muted)',
                              }}
                            >
                              Copy
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {nextCursor && (
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
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
