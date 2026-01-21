import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FEATURED_STREAMS } from '../data/featuredStreams';
import { TopNav } from '../components/TopNav';
import { youtubeThumbnailUrl } from '../lib/youtube';

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

      <main className="container" style={{ paddingTop: '24px' }}>
        <div className="page-header">
          <h1 style={{ fontSize: '22px', fontWeight: 700 }}>Live</h1>
        </div>

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
