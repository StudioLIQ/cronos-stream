import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FEATURED_STREAMS } from '../data/featuredStreams';
import { TopNav } from '../components/TopNav';
import { isYouTubeChannelId, youtubeThumbnailUrl } from '../lib/youtube';
import { EmptyState } from '../components/EmptyState';
import { fetchStreamStatus } from '../lib/api';
import type { StreamStatusResponse } from '../lib/api';

export default function Home() {
  const [query, setQuery] = useState('');
  const [streamStatusBySlug, setStreamStatusBySlug] = useState<Record<string, StreamStatusResponse>>({});

  useEffect(() => {
    const slugsToCheck = FEATURED_STREAMS.filter((s) => isYouTubeChannelId(s.youtube.url)).map((s) => s.slug);
    if (slugsToCheck.length === 0) return;

    let cancelled = false;

    const refresh = async () => {
      const entries = await Promise.all(
        slugsToCheck.map(async (slug) => {
          try {
            const status = await fetchStreamStatus(slug);
            return [slug, status] as const;
          } catch {
            return [slug, { ok: true, status: 'unknown', checkedAt: new Date().toISOString() } as StreamStatusResponse] as const;
          }
        })
      );

      if (cancelled) return;
      setStreamStatusBySlug((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    };

    refresh();
    const interval = setInterval(refresh, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FEATURED_STREAMS;

    return FEATURED_STREAMS.filter((s) => {
      const haystack = `${s.title} ${s.creatorName} ${s.category || ''} ${(s.tags || []).join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [query]);

  return (
    <div>
      <TopNav>
        <div className="topbar-search">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search streams..."
            className="search-input"
            aria-label="Search streams"
          />
        </div>
      </TopNav>

      {/* Hero Section */}
      <section
        style={{
          background: 'var(--hero-bg)',
          borderBottom: '1px solid var(--border)',
          padding: '48px 24px',
        }}
      >
        <div className="container" style={{ textAlign: 'center', maxWidth: '720px', margin: '0 auto' }}>
          <h1 style={{ fontSize: '36px', fontWeight: 800, marginBottom: '16px', lineHeight: 1.2 }}>
            Paid Interactions for Streamers
          </h1>
          <p style={{ fontSize: '18px', color: 'var(--muted)', lineHeight: 1.6 }}>
            Let viewers support you with USDC payments. Effects, Q&A, donations - all settled on-chain via x402.
          </p>
          <div style={{ marginTop: '22px', display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <Link
              to="/dashboard"
              style={{
                background: 'var(--primary)',
                color: 'var(--primary-text)',
                border: '1px solid transparent',
                padding: '10px 14px',
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Open Streamer Dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section className="container" style={{ padding: '48px 24px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 700, textAlign: 'center', marginBottom: '32px' }}>
          How it Works
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '24px',
            maxWidth: '900px',
            margin: '0 auto',
          }}
        >
          <div className="card" style={{ textAlign: 'center', padding: '24px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: 'rgba(0, 248, 137, 0.18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: '24px',
              }}
            >
              1
            </div>
            <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>Pay with Wallet</h3>
            <p style={{ color: 'var(--muted)', fontSize: '14px', lineHeight: 1.5 }}>
              Connect your wallet and sign a transaction to trigger an effect or submit a question.
            </p>
          </div>

          <div className="card" style={{ textAlign: 'center', padding: '24px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: 'rgba(2, 127, 128, 0.18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: '24px',
              }}
            >
              2
            </div>
            <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>x402 Settlement</h3>
            <p style={{ color: 'var(--muted)', fontSize: '14px', lineHeight: 1.5 }}>
              Payment is verified and settled on-chain using the x402 protocol. Instant confirmation.
            </p>
          </div>

          <div className="card" style={{ textAlign: 'center', padding: '24px' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: 'rgba(0, 199, 110, 0.18)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: '24px',
              }}
            >
              3
            </div>
            <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>See on Stream</h3>
            <p style={{ color: 'var(--muted)', fontSize: '14px', lineHeight: 1.5 }}>
              Effects and questions appear on the OBS overlay in real-time. Streamer gets the USDC.
            </p>
          </div>
        </div>

      </section>

      <main className="container" style={{ paddingTop: '24px', paddingBottom: '48px' }}>
        <div className="page-header">
          <h2 style={{ fontSize: '22px', fontWeight: 700 }}>Live Streams</h2>
        </div>

        {filtered.length === 0 && query.trim() !== '' && (
          <div className="card" style={{ marginTop: '18px' }}>
            <EmptyState
              icon="🔍"
              title="No streams found"
              description={`No streams match "${query}". Try a different search term.`}
              action={
                <button
                  onClick={() => setQuery('')}
                  style={{ background: 'var(--primary)', color: 'var(--primary-text)' }}
                >
                  Clear Search
                </button>
              }
            />
          </div>
        )}

        <div className="stream-grid" style={{ marginTop: '18px' }}>
          {filtered.map((stream) => {
            const thumb = stream.thumbnailUrl || youtubeThumbnailUrl(stream.youtube.url);
            const to = `/v/${encodeURIComponent(stream.slug)}`;
            const requiresLiveCheck = isYouTubeChannelId(stream.youtube.url);
            const status = streamStatusBySlug[stream.slug];
            const isLive = status?.ok && status.status === 'live';
            const isDisabled =
              requiresLiveCheck && status?.ok && (status.status === 'offline' || status.status === 'unconfigured');

            const showOfflineBadge = requiresLiveCheck && status?.ok && (status.status === 'offline' || status.status === 'unconfigured');
            const showCheckingBadge = requiresLiveCheck && (!status || (status.ok && status.status === 'unknown'));

            const CardInner = (
              <>
                <div className="stream-thumb">
                  {thumb ? (
                    <img src={thumb} alt="" loading="lazy" />
                  ) : (
                    <div className="stream-thumb-fallback">YouTube</div>
                  )}
                  <div className="stream-badges">
                    {(!requiresLiveCheck || isLive) && <span className="badge badge-live">LIVE</span>}
                    {showOfflineBadge && <span className="badge badge-offline">OFFLINE</span>}
                    {!showOfflineBadge && showCheckingBadge && <span className="badge badge-checking">CHECKING</span>}
                    <span className="badge badge-platform">YouTube</span>
                  </div>
                </div>

                <div className="stream-meta">
                  <div className="stream-title">{stream.title}</div>
                  <div className="stream-creator">{stream.creatorName}</div>
                  {(stream.category || (stream.tags && stream.tags.length > 0)) && (
                    <div className="stream-tags">
                      {stream.category && <span className="tag">{stream.category}</span>}
                      {(stream.tags || []).slice(0, 3).map((t) => (
                        <span key={t} className="tag">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </>
            );

            if (isDisabled) {
              return (
                <div key={stream.id} className="stream-card stream-card-disabled" aria-disabled="true">
                  {CardInner}
                </div>
              );
            }

            return (
              <Link key={stream.id} to={to} className="stream-card">
                {CardInner}
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
