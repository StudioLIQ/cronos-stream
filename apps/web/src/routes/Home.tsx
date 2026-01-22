import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FEATURED_STREAMS } from '../data/featuredStreams';
import { TopNav } from '../components/TopNav';
import { youtubeThumbnailUrl } from '../lib/youtube';
import { EmptyState } from '../components/EmptyState';

export default function Home() {
  const [query, setQuery] = useState('');

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
          <p style={{ fontSize: '18px', color: 'var(--muted)', marginBottom: '32px', lineHeight: 1.6 }}>
            Let viewers support you with USDC payments. Effects, Q&A, donations - all settled on-chain via x402.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              to="/v/demo"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '14px 28px',
                background: 'var(--primary)',
                color: 'var(--primary-text)',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '16px',
                textDecoration: 'none',
              }}
            >
              Open Demo
            </Link>
            <Link
              to="/d/demo"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '14px 28px',
                background: 'transparent',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '16px',
                textDecoration: 'none',
              }}
            >
              Streamer Dashboard
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

        {/* Quick Links */}
        <div
          style={{
            display: 'flex',
            gap: '16px',
            justifyContent: 'center',
            marginTop: '32px',
            flexWrap: 'wrap',
          }}
        >
          <Link to="/v/demo" style={{ color: 'var(--accent-text)', fontSize: '14px' }}>
            Viewer Page
          </Link>
          <Link to="/o/demo" style={{ color: 'var(--accent-text)', fontSize: '14px' }}>
            OBS Overlay
          </Link>
          <Link to="/d/demo" style={{ color: 'var(--accent-text)', fontSize: '14px' }}>
            Dashboard
          </Link>
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

            return (
              <Link key={stream.id} to={to} className="stream-card">
                <div className="stream-thumb">
                  {thumb ? (
                    <img src={thumb} alt="" loading="lazy" />
                  ) : (
                    <div className="stream-thumb-fallback">YouTube</div>
                  )}
                  <div className="stream-badges">
                    <span className="badge badge-live">LIVE</span>
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
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
