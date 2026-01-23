import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopNav } from '../components/TopNav';
import { useToasts } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { API_BASE } from '../lib/config';
import { copyToClipboard } from '../lib/clipboard';
import { formatUsdcAmount } from '../lib/x402';

type ChannelOverview = {
  slug: string;
  displayName: string;
  payToAddress: string;
  network: string;
  chainId: number | null;
  usdcAddress: string | null;
  totalSettledValueBaseUnits: string;
  settledCount: number;
  lastSettledAt: number | null;
  usdcBalanceBaseUnits: string | null;
  usdcBalanceError: string | null;
};

type DashboardOverviewResponse = {
  generatedAt: number;
  channels: ChannelOverview[];
};

function safeBigInt(value: string | null | undefined): bigint {
  try {
    return BigInt(value || '0');
  } catch {
    return 0n;
  }
}

function formatAddress(address: string): string {
  if (!address) return '—';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatUnixSeconds(ts: number | null): string {
  if (!ts) return '—';
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export default function Dashboard() {
  const { addToast } = useToasts();
  const [data, setData] = useState<DashboardOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/dashboard/overview`);
      if (!res.ok) {
        throw new Error(`Failed to load dashboard overview (${res.status})`);
      }
      const json = (await res.json()) as DashboardOverviewResponse;
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(fetchOverview, 15_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, fetchOverview]);

  const totals = useMemo(() => {
    if (!data) return null;
    const totalReceived = data.channels.reduce((acc, ch) => acc + safeBigInt(ch.totalSettledValueBaseUnits), 0n);
    const totalBalanceKnown = data.channels.reduce((acc, ch) => acc + safeBigInt(ch.usdcBalanceBaseUnits), 0n);
    const balanceKnownCount = data.channels.filter((ch) => !!ch.usdcBalanceBaseUnits).length;
    return { totalReceived, totalBalanceKnown, balanceKnownCount };
  }, [data]);

  const rankedChannels = useMemo(() => {
    if (!data) return [];
    return [...data.channels].sort((a, b) => {
      const aTotal = safeBigInt(a.totalSettledValueBaseUnits);
      const bTotal = safeBigInt(b.totalSettledValueBaseUnits);
      if (aTotal === bTotal) return a.displayName.localeCompare(b.displayName);
      return aTotal > bTotal ? -1 : 1;
    });
  }, [data]);

  const generatedAt = data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : null;

  const handleCopyAddress = async (address: string) => {
    const ok = await copyToClipboard(address);
    addToast(ok ? 'Copied wallet address' : 'Failed to copy wallet address', ok ? 'success' : 'error');
  };

  return (
    <>
      <TopNav />
      <main className="container" style={{ paddingTop: '20px', paddingBottom: '48px' }}>
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0 }}>Dashboard</h1>
            <div style={{ marginTop: '6px', color: 'var(--muted)', fontSize: '13px' }}>
              All streamers: total received + current USDC balance
              {generatedAt ? ` · updated ${generatedAt}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--muted)', fontSize: '13px' }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto refresh (15s)
            </label>
            <button
              onClick={fetchOverview}
              disabled={loading}
              style={{ background: 'var(--primary)', color: 'var(--primary-text)' }}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && (
          <div className="card" style={{ borderColor: 'rgba(255, 92, 92, 0.35)' }}>
            <div style={{ color: 'var(--danger)', fontWeight: 700 }}>Failed to load</div>
            <div style={{ marginTop: '6px', color: 'var(--muted)', fontSize: '13px' }}>{error}</div>
          </div>
        )}

        {totals && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div className="card" style={{ marginBottom: 0 }}>
              <div style={{ color: 'var(--muted)', fontSize: '12px' }}>Total received (all channels)</div>
              <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '6px' }}>${formatUsdcAmount(totals.totalReceived.toString())}</div>
            </div>
            <div className="card" style={{ marginBottom: 0 }}>
              <div style={{ color: 'var(--muted)', fontSize: '12px' }}>Total USDC balance (known)</div>
              <div style={{ fontSize: '22px', fontWeight: 800, marginTop: '6px' }}>${formatUsdcAmount(totals.totalBalanceKnown.toString())}</div>
              <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '6px' }}>
                {totals.balanceKnownCount}/{data?.channels.length ?? 0} wallets fetched
              </div>
            </div>
          </div>
        )}

        {!loading && data && data.channels.length === 0 && (
          <div className="card">
            <EmptyState icon="📺" title="No channels found" description="Seed the database or create channels first." />
          </div>
        )}

        {data && data.channels.length > 0 && (
          <div className="card">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1040px' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: '12px' }}>
                    <th style={{ padding: '10px 12px' }}>#</th>
                    <th style={{ padding: '10px 12px' }}>Streamer</th>
                    <th style={{ padding: '10px 12px' }}>Total received</th>
                    <th style={{ padding: '10px 12px' }}>USDC balance</th>
                    <th style={{ padding: '10px 12px' }}>Supports</th>
                    <th style={{ padding: '10px 12px' }}>Last settled</th>
                    <th style={{ padding: '10px 12px' }}>Wallet</th>
                    <th style={{ padding: '10px 12px' }}>Links</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedChannels.map((ch, index) => (
                    <tr key={ch.slug} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {index + 1}
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ fontWeight: 800 }}>{ch.displayName}</div>
                        <div style={{ marginTop: '4px', color: 'var(--muted)', fontSize: '12px' }}>
                          <code style={{ color: 'var(--accent-text)' }}>{ch.slug}</code>
                          <span style={{ marginLeft: '8px' }}>
                            {ch.network}
                            {ch.chainId ? ` (${ch.chainId})` : ''}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '12px', fontWeight: 800 }}>${formatUsdcAmount(ch.totalSettledValueBaseUnits)}</td>
                      <td style={{ padding: '12px' }}>
                        {ch.usdcBalanceBaseUnits ? (
                          <span style={{ fontWeight: 800 }}>${formatUsdcAmount(ch.usdcBalanceBaseUnits)}</span>
                        ) : (
                          <span title={ch.usdcBalanceError || undefined} style={{ color: 'var(--muted)' }}>
                            —
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px' }}>{ch.settledCount.toLocaleString()}</td>
                      <td style={{ padding: '12px', color: 'var(--muted)' }}>{formatUnixSeconds(ch.lastSettledAt)}</td>
                      <td style={{ padding: '12px' }}>
                        <button
                          onClick={() => handleCopyAddress(ch.payToAddress)}
                          title={ch.payToAddress}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            padding: '6px 10px',
                            borderRadius: '999px',
                            fontSize: '12px',
                            color: 'var(--muted)',
                          }}
                        >
                          {formatAddress(ch.payToAddress)} Copy
                        </button>
                      </td>
                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <Link to={`/v/${encodeURIComponent(ch.slug)}`} style={{ color: 'var(--accent-text)', fontSize: '13px' }}>
                            Viewer
                          </Link>
	                        </div>
	                      </td>
	                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
