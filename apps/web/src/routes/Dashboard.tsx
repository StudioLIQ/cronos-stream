import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { connectSSE } from '../lib/sse';

interface QaItem {
  id: string;
  fromAddress: string;
  displayName: string | null;
  message: string;
  tier: string;
  priceBaseUnits: string;
  status: string;
  createdAt: string;
  shownAt: string | null;
  closedAt: string | null;
}

interface QaCreatedEvent {
  qaId: string;
  tier: string;
  message: string;
  displayName: string | null;
  amount: string;
  from: string;
  txHash: string;
  createdAt: number;
}

interface QaUpdatedEvent {
  qaId: string;
  status: string;
}

const API_BASE = '/api';

export default function Dashboard() {
  const { slug } = useParams<{ slug: string }>();
  const [token, setToken] = useState(() => localStorage.getItem('dashboard_token') || '');
  const [authenticated, setAuthenticated] = useState(false);
  const [items, setItems] = useState<QaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'queued' | 'showing' | 'answered' | 'skipped' | 'blocked'>('queued');

  const fetchItems = useCallback(async () => {
    if (!slug || !token) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/qa?status=${filter}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401 || res.status === 403) {
        setAuthenticated(false);
        setError('Invalid token');
        return;
      }

      if (!res.ok) {
        throw new Error('Failed to fetch Q&A items');
      }

      const data = await res.json();
      setItems(data);
      setAuthenticated(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug, token, filter]);

  useEffect(() => {
    if (authenticated) {
      fetchItems();
    }
  }, [fetchItems, authenticated, filter]);

  useEffect(() => {
    if (!slug || !authenticated) return;

    const eventSource = connectSSE(`${API_BASE}/channels/${slug}/stream/dashboard`, (eventName, data) => {
      if (eventName === 'qa.created' && filter === 'queued') {
        const event = data as QaCreatedEvent;
        setItems((prev) => [
          ...prev,
          {
            id: event.qaId,
            fromAddress: event.from,
            displayName: event.displayName,
            message: event.message,
            tier: event.tier,
            priceBaseUnits: event.amount,
            status: 'queued',
            createdAt: new Date(event.createdAt).toISOString(),
            shownAt: null,
            closedAt: null,
          },
        ]);
      } else if (eventName === 'qa.updated') {
        const event = data as QaUpdatedEvent;
        setItems((prev) =>
          prev.map((item) =>
            item.id === event.qaId ? { ...item, status: event.status } : item
          ).filter((item) => item.status === filter)
        );
      }
    });

    return () => {
      eventSource.close();
    };
  }, [slug, authenticated, filter]);

  const handleAuth = () => {
    localStorage.setItem('dashboard_token', token);
    setAuthenticated(true);
  };

  const handleAction = async (qaId: string, state: string) => {
    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/qa/${qaId}/state`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ state }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update state');
      }

      // Remove from current list immediately
      setItems((prev) => prev.filter((item) => item.id !== qaId));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!authenticated) {
    return (
      <div className="container">
        <h1>Dashboard - {slug}</h1>
        <div className="card" style={{ marginTop: '24px' }}>
          <h2>Authentication Required</h2>
          <div style={{ marginTop: '16px' }}>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter dashboard token"
              style={{ width: '100%', marginBottom: '12px' }}
            />
            <button
              onClick={handleAuth}
              style={{ background: '#3b82f6', color: '#fff', width: '100%' }}
            >
              Authenticate
            </button>
          </div>
          {error && <p style={{ marginTop: '12px', color: '#ef4444' }}>{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <header style={{ marginBottom: '24px' }}>
        <h1>Dashboard - {slug}</h1>
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
          {(['queued', 'showing', 'answered', 'skipped', 'blocked'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              style={{
                background: filter === status ? '#3b82f6' : '#1a1a1a',
                color: '#fff',
                border: '1px solid #333',
              }}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="card" style={{ background: '#dc2626', marginBottom: '16px' }}>
          <p>{error}</p>
          <button onClick={() => setError(null)} style={{ marginTop: '8px', background: '#fff', color: '#000' }}>
            Dismiss
          </button>
        </div>
      )}

      {loading && <p>Loading...</p>}

      {!loading && items.length === 0 && (
        <p style={{ color: '#888' }}>No items with status: {filter}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {items.map((item) => (
          <div key={item.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <div>
                <span className={`status-badge ${item.status}`}>{item.status}</span>
                <span
                  style={{
                    marginLeft: '8px',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    background: item.tier === 'priority' ? '#f59e0b' : '#6b7280',
                  }}
                >
                  {item.tier}
                </span>
              </div>
              <span style={{ fontSize: '12px', color: '#888' }}>
                {new Date(item.createdAt).toLocaleTimeString()}
              </span>
            </div>

            <p style={{ fontWeight: 500, marginBottom: '8px' }}>
              {item.displayName || item.fromAddress.slice(0, 8) + '...'}
            </p>
            <p style={{ marginBottom: '16px', lineHeight: 1.5 }}>{item.message}</p>

            {filter === 'queued' && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleAction(item.id, 'show')}
                  style={{ background: '#10b981', color: '#fff' }}
                >
                  Show
                </button>
                <button
                  onClick={() => handleAction(item.id, 'answered')}
                  style={{ background: '#3b82f6', color: '#fff' }}
                >
                  Answered
                </button>
                <button
                  onClick={() => handleAction(item.id, 'skipped')}
                  style={{ background: '#6b7280', color: '#fff' }}
                >
                  Skip
                </button>
                <button
                  onClick={() => handleAction(item.id, 'blocked')}
                  style={{ background: '#ef4444', color: '#fff' }}
                >
                  Block
                </button>
              </div>
            )}

            {filter === 'showing' && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleAction(item.id, 'answered')}
                  style={{ background: '#10b981', color: '#fff' }}
                >
                  Mark Answered
                </button>
                <button
                  onClick={() => handleAction(item.id, 'skipped')}
                  style={{ background: '#6b7280', color: '#fff' }}
                >
                  Skip
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
