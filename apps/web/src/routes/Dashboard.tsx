import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { connectSSE } from '../lib/sse';
import { QaItemSkeleton, LeaderboardItemSkeleton, MemberItemSkeleton, GoalItemSkeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ShareLinks } from '../components/ShareLinks';
import { generateCsv, downloadCsv, formatTimestamp, formatDatetime } from '../lib/csv';

interface QaItem {
  id: string;
  fromAddress: string;
  displayName: string | null;
  message: string;
  tier: string;
  priceBaseUnits: string;
  status: string;
  isMember: boolean;
  memberPlanId: string | null;
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
  isMember: boolean;
  memberPlanId: string | null;
}

interface QaUpdatedEvent {
  qaId: string;
  status: string;
}

interface SupportItem {
  paymentId: string;
  kind: string | null;
  value: string;
  txHash: string | null;
  timestamp: number | null;
  actionKey: string | null;
  qaId: string | null;
  displayName: string | null;
}

interface LeaderboardEntry {
  fromAddress: string;
  totalValueBaseUnits: string;
  supportCount: number;
  lastSupportedAt: number | null;
  displayName: string | null;
}

interface MemberItem {
  id: string;
  fromAddress: string;
  planId: string;
  planName: string;
  expiresAt: string;
  revoked: boolean;
  active: boolean;
  createdAt: string;
}

interface GoalItem {
  id: string;
  type: 'donation' | 'membership';
  name: string;
  targetValue: string;
  currentValue: string;
  startsAt: string | null;
  endsAt: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const API_BASE = '/api';

function formatUSDC(baseUnits: string): string {
  const num = BigInt(baseUnits);
  const whole = num / BigInt(1000000);
  const frac = num % BigInt(1000000);
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export default function Dashboard() {
  const { slug } = useParams<{ slug: string }>();
  const [token, setToken] = useState(() => localStorage.getItem('dashboard_token') || '');
  const [authenticated, setAuthenticated] = useState(false);
  const [items, setItems] = useState<QaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'queued' | 'showing' | 'answered' | 'skipped' | 'blocked'>('queued');

  // Tab state
  const [activeTab, setActiveTab] = useState<'qa' | 'supports' | 'members' | 'goals'>('qa');

  // Supports state
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<'all' | '30d' | '7d' | '24h'>('all');
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [walletLookup, setWalletLookup] = useState('');
  const [walletSupports, setWalletSupports] = useState<SupportItem[]>([]);
  const [walletSupportsLoading, setWalletSupportsLoading] = useState(false);

  // Members state
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberFilter, setMemberFilter] = useState<'all' | 'active' | 'expired' | 'revoked'>('active');
  const [memberSearch, setMemberSearch] = useState('');

  // Demo reset state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // Goals state
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [newGoal, setNewGoal] = useState({ type: 'donation' as 'donation' | 'membership', name: '', targetValue: '' });

  // Stats state
  const [stats, setStats] = useState<{
    totalRevenue: string;
    todayRevenue: string;
    totalSupporters: number;
    activeMembers: number;
    queuedQA: number;
    totalTransactions: number;
  } | null>(null);

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

  const fetchLeaderboard = useCallback(async () => {
    if (!slug || !token) return;
    setLeaderboardLoading(true);

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/leaderboard?period=${leaderboardPeriod}&limit=20`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch leaderboard');
      }

      const data = await res.json();
      setLeaderboard(data.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [slug, token, leaderboardPeriod]);

  const fetchWalletSupports = useCallback(async (address: string) => {
    if (!slug || !token || !address) return;
    setWalletSupportsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/supports?from=${address.toLowerCase()}&limit=50`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch wallet supports');
      }

      const data = await res.json();
      setWalletSupports(data.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWalletSupportsLoading(false);
    }
  }, [slug, token]);

  const fetchMembers = useCallback(async () => {
    if (!slug || !token) return;
    setMembersLoading(true);

    try {
      const params = new URLSearchParams();
      if (memberFilter !== 'all') params.set('status', memberFilter);
      if (memberSearch) params.set('search', memberSearch);

      const res = await fetch(`${API_BASE}/channels/${slug}/memberships?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch members');
      }

      const data = await res.json();
      setMembers(data.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMembersLoading(false);
    }
  }, [slug, token, memberFilter, memberSearch]);

  const revokeMember = async (address: string) => {
    if (!slug || !token) return;

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/memberships/${address}/revoke`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to revoke membership');
      }

      // Refresh members list
      fetchMembers();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const fetchGoals = useCallback(async () => {
    if (!slug || !token) return;
    setGoalsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/goals`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch goals');
      }

      const data = await res.json();
      setGoals(data.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGoalsLoading(false);
    }
  }, [slug, token]);

  const fetchStats = useCallback(async () => {
    if (!slug || !token) return;

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/stats`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch stats');
      }

      const data = await res.json();
      setStats(data);
    } catch (err) {
      // Ignore errors for stats
    }
  }, [slug, token]);

  const createGoal = async () => {
    if (!slug || !token) return;

    // Validate inputs
    if (!newGoal.name.trim()) {
      setError('Goal name is required');
      return;
    }

    // For donation goals, convert USDC amount to base units
    let targetValue = newGoal.targetValue;
    if (newGoal.type === 'donation') {
      const parsed = parseFloat(newGoal.targetValue);
      if (isNaN(parsed) || parsed <= 0) {
        setError('Target value must be a positive number');
        return;
      }
      targetValue = Math.round(parsed * 1000000).toString();
    } else {
      const parsed = parseInt(newGoal.targetValue, 10);
      if (isNaN(parsed) || parsed <= 0) {
        setError('Target value must be a positive integer');
        return;
      }
      targetValue = parsed.toString();
    }

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/goals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: newGoal.type,
          name: newGoal.name.trim(),
          targetValue,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create goal');
      }

      setShowGoalForm(false);
      setNewGoal({ type: 'donation', name: '', targetValue: '' });
      fetchGoals();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const deleteGoal = async (goalId: string) => {
    if (!slug || !token) return;

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/goals/${goalId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete goal');
      }

      fetchGoals();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const resetGoal = async (goalId: string) => {
    if (!slug || !token) return;

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/goals/${goalId}/reset`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reset goal');
      }

      fetchGoals();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggleGoalEnabled = async (goalId: string, enabled: boolean) => {
    if (!slug || !token) return;

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/goals/${goalId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update goal');
      }

      fetchGoals();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const exportSupports = async () => {
    if (!slug || !token) return;

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/export/supports`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to export supports');
      }

      const data = await res.json();
      const csv = generateCsv(
        data.items.map((item: { paymentId: string; fromAddress: string; displayName: string | null; value: string; kind: string | null; actionKey: string | null; qaId: string | null; txHash: string | null; timestamp: number | null; createdAt: string }) => ({
          paymentId: item.paymentId,
          fromAddress: item.fromAddress,
          displayName: item.displayName || '',
          valueUSDC: (Number(BigInt(item.value)) / 1000000).toFixed(6),
          valueBaseUnits: item.value,
          kind: item.kind || '',
          actionKey: item.actionKey || '',
          txHash: item.txHash || '',
          timestamp: formatTimestamp(item.timestamp),
          createdAt: formatDatetime(item.createdAt),
        })),
        [
          { key: 'paymentId', header: 'Payment ID' },
          { key: 'fromAddress', header: 'Wallet Address' },
          { key: 'displayName', header: 'Display Name' },
          { key: 'valueUSDC', header: 'Amount (USDC)' },
          { key: 'valueBaseUnits', header: 'Amount (Base Units)' },
          { key: 'kind', header: 'Type' },
          { key: 'actionKey', header: 'Action Key' },
          { key: 'txHash', header: 'Transaction Hash' },
          { key: 'timestamp', header: 'Timestamp' },
          { key: 'createdAt', header: 'Created At' },
        ]
      );

      downloadCsv(csv, `supports-${slug}-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const exportMembers = async () => {
    if (!slug || !token) return;

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/export/members`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to export members');
      }

      const data = await res.json();
      const csv = generateCsv(
        data.items.map((item: { id: string; fromAddress: string; displayName: string | null; planId: string; planName: string; expiresAt: string; revoked: boolean; active: boolean; createdAt: string }) => ({
          id: item.id,
          fromAddress: item.fromAddress,
          displayName: item.displayName || '',
          planName: item.planName,
          status: item.active ? 'Active' : item.revoked ? 'Revoked' : 'Expired',
          expiresAt: formatDatetime(item.expiresAt),
          createdAt: formatDatetime(item.createdAt),
        })),
        [
          { key: 'id', header: 'Membership ID' },
          { key: 'fromAddress', header: 'Wallet Address' },
          { key: 'displayName', header: 'Display Name' },
          { key: 'planName', header: 'Plan' },
          { key: 'status', header: 'Status' },
          { key: 'expiresAt', header: 'Expires At' },
          { key: 'createdAt', header: 'Created At' },
        ]
      );

      downloadCsv(csv, `members-${slug}-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    if (authenticated && activeTab === 'qa') {
      fetchItems();
    }
  }, [fetchItems, authenticated, filter, activeTab]);

  useEffect(() => {
    if (authenticated && activeTab === 'supports') {
      fetchLeaderboard();
    }
  }, [fetchLeaderboard, authenticated, leaderboardPeriod, activeTab]);

  useEffect(() => {
    if (authenticated && activeTab === 'members') {
      fetchMembers();
    }
  }, [fetchMembers, authenticated, memberFilter, activeTab]);

  useEffect(() => {
    if (authenticated && activeTab === 'goals') {
      fetchGoals();
    }
  }, [fetchGoals, authenticated, activeTab]);

  // Fetch stats on authentication
  useEffect(() => {
    if (authenticated) {
      fetchStats();
    }
  }, [fetchStats, authenticated]);

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
            isMember: event.isMember || false,
            memberPlanId: event.memberPlanId || null,
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

  const handleDemoReset = async () => {
    if (slug !== 'demo') return;
    setResetLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/channels/${slug}/demo/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reset demo data');
      }

      // Refresh the Q&A list
      await fetchItems();
      setShowResetConfirm(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResetLoading(false);
    }
  };

  const handleWalletLookup = () => {
    if (walletLookup && /^0x[a-fA-F0-9]{40}$/.test(walletLookup)) {
      fetchWalletSupports(walletLookup);
    }
  };

  const handleLeaderboardClick = (address: string) => {
    setWalletLookup(address);
    fetchWalletSupports(address);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>Dashboard - {slug}</h1>
          {slug === 'demo' && (
            <button
              onClick={() => setShowResetConfirm(true)}
              style={{
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Reset Demo Data
            </button>
          )}
        </div>
        {/* Tab navigation */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button
            onClick={() => setActiveTab('qa')}
            style={{
              background: activeTab === 'qa' ? '#3b82f6' : '#1a1a1a',
              color: '#fff',
              border: '1px solid #333',
              padding: '8px 16px',
            }}
          >
            Q&A Queue
          </button>
          <button
            onClick={() => setActiveTab('supports')}
            style={{
              background: activeTab === 'supports' ? '#3b82f6' : '#1a1a1a',
              color: '#fff',
              border: '1px solid #333',
              padding: '8px 16px',
            }}
          >
            Supports
          </button>
          <button
            onClick={() => setActiveTab('members')}
            style={{
              background: activeTab === 'members' ? '#3b82f6' : '#1a1a1a',
              color: '#fff',
              border: '1px solid #333',
              padding: '8px 16px',
            }}
          >
            Members
          </button>
          <button
            onClick={() => setActiveTab('goals')}
            style={{
              background: activeTab === 'goals' ? '#3b82f6' : '#1a1a1a',
              color: '#fff',
              border: '1px solid #333',
              padding: '8px 16px',
            }}
          >
            Goals
          </button>
        </div>
        {activeTab === 'qa' && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
            {(['queued', 'showing', 'answered', 'skipped', 'blocked'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}
                style={{
                  background: filter === status ? '#6366f1' : '#1a1a1a',
                  color: '#fff',
                  border: '1px solid #333',
                  fontSize: '14px',
                }}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        )}
      </header>

      {error && (
        <div className="card" style={{ background: '#dc2626', marginBottom: '16px' }}>
          <p>{error}</p>
          <button onClick={() => setError(null)} style={{ marginTop: '8px', background: '#fff', color: '#000' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Share Links */}
      {slug && <ShareLinks slug={slug} />}

      {/* KPI Cards */}
      {stats && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          <div className="card" style={{ marginBottom: 0, textAlign: 'center', padding: '16px' }}>
            <p style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Total Revenue</p>
            <p style={{ fontSize: '24px', fontWeight: 700, color: '#10b981' }}>
              ${formatUSDC(stats.totalRevenue)}
            </p>
          </div>
          <div className="card" style={{ marginBottom: 0, textAlign: 'center', padding: '16px' }}>
            <p style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Today</p>
            <p style={{ fontSize: '24px', fontWeight: 700, color: '#3b82f6' }}>
              ${formatUSDC(stats.todayRevenue)}
            </p>
          </div>
          <div className="card" style={{ marginBottom: 0, textAlign: 'center', padding: '16px' }}>
            <p style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Supporters</p>
            <p style={{ fontSize: '24px', fontWeight: 700 }}>
              {stats.totalSupporters}
            </p>
          </div>
          <div className="card" style={{ marginBottom: 0, textAlign: 'center', padding: '16px' }}>
            <p style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Active Members</p>
            <p style={{ fontSize: '24px', fontWeight: 700, color: '#6366f1' }}>
              {stats.activeMembers}
            </p>
          </div>
          <div className="card" style={{ marginBottom: 0, textAlign: 'center', padding: '16px' }}>
            <p style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Q&A Queue</p>
            <p style={{ fontSize: '24px', fontWeight: 700, color: stats.queuedQA > 0 ? '#f59e0b' : '#888' }}>
              {stats.queuedQA}
            </p>
          </div>
          <div className="card" style={{ marginBottom: 0, textAlign: 'center', padding: '16px' }}>
            <p style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>Transactions</p>
            <p style={{ fontSize: '24px', fontWeight: 700 }}>
              {stats.totalTransactions}
            </p>
          </div>
        </div>
      )}

      {/* Q&A Tab */}
      {activeTab === 'qa' && (
        <>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <QaItemSkeleton />
              <QaItemSkeleton />
              <QaItemSkeleton />
            </div>
          )}

          {!loading && items.length === 0 && (
            <EmptyState
              icon={filter === 'queued' ? '📥' : filter === 'answered' ? '✅' : '📋'}
              title={`No ${filter} questions`}
              description={
                filter === 'queued'
                  ? 'New questions from viewers will appear here. Share your viewer page to start receiving paid Q&As.'
                  : `Questions that have been ${filter} will appear here.`
              }
            />
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {items.map((item) => (
              <div key={item.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span className={`status-badge ${item.status}`}>{item.status}</span>
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        background: item.tier === 'priority' ? '#f59e0b' : '#6b7280',
                      }}
                    >
                      {item.tier}
                    </span>
                    {item.isMember && (
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          background: '#6366f1',
                          fontWeight: 'bold',
                        }}
                      >
                        MEMBER
                      </span>
                    )}
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
        </>
      )}

      {/* Supports Tab */}
      {activeTab === 'supports' && (
        <>
        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={exportSupports}
            style={{
              background: '#10b981',
              color: '#fff',
              padding: '8px 16px',
              fontSize: '14px',
            }}
          >
            Export CSV
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          {/* Leaderboard Section */}
          <div className="card">
            <h2 style={{ marginBottom: '16px' }}>Top Supporters</h2>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {(['all', '30d', '7d', '24h'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setLeaderboardPeriod(p)}
                  style={{
                    background: leaderboardPeriod === p ? '#6366f1' : '#1a1a1a',
                    color: '#fff',
                    border: '1px solid #333',
                    fontSize: '12px',
                    padding: '6px 12px',
                  }}
                >
                  {p === 'all' ? 'All Time' : p}
                </button>
              ))}
            </div>

            {leaderboardLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <LeaderboardItemSkeleton />
                <LeaderboardItemSkeleton />
                <LeaderboardItemSkeleton />
                <LeaderboardItemSkeleton />
                <LeaderboardItemSkeleton />
              </div>
            )}

            {!leaderboardLoading && leaderboard.length === 0 && (
              <EmptyState
                icon="🏆"
                title="No supporters yet"
                description="When viewers support your stream, the top supporters will appear here."
              />
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {leaderboard.map((entry, idx) => (
                <div
                  key={entry.fromAddress}
                  onClick={() => handleLeaderboardClick(entry.fromAddress)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px',
                    background: '#1a1a1a',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontWeight: 'bold', color: '#888', width: '24px' }}>#{idx + 1}</span>
                    <div>
                      <p style={{ fontWeight: 500, marginBottom: '2px' }}>
                        {entry.displayName || `${entry.fromAddress.slice(0, 6)}...${entry.fromAddress.slice(-4)}`}
                      </p>
                      <p style={{ fontSize: '12px', color: '#888' }}>
                        {entry.supportCount} supports
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontWeight: 'bold', color: '#10b981' }}>
                      ${formatUSDC(entry.totalValueBaseUnits)}
                    </p>
                    {entry.lastSupportedAt && (
                      <p style={{ fontSize: '12px', color: '#888' }}>
                        {new Date(entry.lastSupportedAt * 1000).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Wallet Lookup Section */}
          <div className="card">
            <h2 style={{ marginBottom: '16px' }}>Wallet Lookup</h2>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <input
                type="text"
                value={walletLookup}
                onChange={(e) => setWalletLookup(e.target.value)}
                placeholder="Enter wallet address (0x...)"
                style={{ flex: 1 }}
              />
              <button
                onClick={handleWalletLookup}
                style={{ background: '#3b82f6', color: '#fff' }}
              >
                Search
              </button>
            </div>

            {walletSupportsLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <LeaderboardItemSkeleton />
                <LeaderboardItemSkeleton />
                <LeaderboardItemSkeleton />
              </div>
            )}

            {!walletSupportsLoading && walletLookup && walletSupports.length === 0 && (
              <EmptyState
                icon="🔍"
                title="No supports found"
                description="This wallet hasn't made any supports to this channel yet."
              />
            )}

            {!walletSupportsLoading && !walletLookup && (
              <p style={{ color: '#888', fontSize: '14px', textAlign: 'center', padding: '24px 0' }}>
                Enter a wallet address above to see their support history.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
              {walletSupports.map((support) => (
                <div
                  key={support.paymentId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px',
                    background: '#1a1a1a',
                    borderRadius: '8px',
                  }}
                >
                  <div>
                    <p style={{ fontWeight: 500, marginBottom: '4px' }}>
                      <span
                        style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          marginRight: '8px',
                          background:
                            support.kind === 'donation'
                              ? '#f59e0b'
                              : support.kind === 'qa'
                              ? '#3b82f6'
                              : '#6b7280',
                        }}
                      >
                        {support.kind || 'unknown'}
                      </span>
                      {support.actionKey || support.qaId?.slice(0, 8) || ''}
                    </p>
                    {support.timestamp && (
                      <p style={{ fontSize: '12px', color: '#888' }}>
                        {new Date(support.timestamp * 1000).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontWeight: 'bold', color: '#10b981' }}>
                      ${formatUSDC(support.value)}
                    </p>
                    {support.txHash && (
                      <a
                        href={`https://cronos.org/explorer/testnet3/tx/${support.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: '11px', color: '#6366f1' }}
                      >
                        View tx
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        </>
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <>
        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={exportMembers}
            style={{
              background: '#10b981',
              color: '#fff',
              padding: '8px 16px',
              fontSize: '14px',
            }}
          >
            Export CSV
          </button>
        </div>
        <div className="card">
          <h2 style={{ marginBottom: '16px' }}>Members</h2>

          {/* Filters */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {(['active', 'all', 'expired', 'revoked'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setMemberFilter(status)}
                style={{
                  background: memberFilter === status ? '#6366f1' : '#1a1a1a',
                  color: '#fff',
                  border: '1px solid #333',
                  fontSize: '12px',
                  padding: '6px 12px',
                }}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search by wallet address..."
              style={{ flex: 1 }}
            />
            <button
              onClick={fetchMembers}
              style={{ background: '#3b82f6', color: '#fff' }}
            >
              Search
            </button>
          </div>

          {membersLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <MemberItemSkeleton />
              <MemberItemSkeleton />
              <MemberItemSkeleton />
            </div>
          )}

          {!membersLoading && members.length === 0 && (
            <EmptyState
              icon="👥"
              title="No members yet"
              description={
                memberFilter === 'active'
                  ? 'Active channel members will appear here. Set up membership plans to start accepting subscribers.'
                  : `No ${memberFilter} members found.`
              }
            />
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {members.map((member) => (
              <div
                key={member.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px',
                  background: '#1a1a1a',
                  borderRadius: '8px',
                }}
              >
                <div>
                  <p style={{ fontWeight: 500, marginBottom: '4px' }}>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        marginRight: '8px',
                        background: member.active
                          ? '#10b981'
                          : member.revoked
                          ? '#ef4444'
                          : '#6b7280',
                      }}
                    >
                      {member.active ? 'Active' : member.revoked ? 'Revoked' : 'Expired'}
                    </span>
                    {`${member.fromAddress.slice(0, 6)}...${member.fromAddress.slice(-4)}`}
                  </p>
                  <p style={{ fontSize: '12px', color: '#888' }}>
                    {member.planName} - Expires: {new Date(member.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {!member.revoked && (
                    <button
                      onClick={() => revokeMember(member.fromAddress)}
                      style={{
                        background: '#ef4444',
                        color: '#fff',
                        fontSize: '12px',
                        padding: '6px 12px',
                      }}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        </>
      )}

      {/* Goals Tab */}
      {activeTab === 'goals' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2>Goals</h2>
            <button
              onClick={() => setShowGoalForm(true)}
              style={{ background: '#10b981', color: '#fff', padding: '8px 16px' }}
            >
              + New Goal
            </button>
          </div>

          {goalsLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <GoalItemSkeleton />
              <GoalItemSkeleton />
            </div>
          )}

          {!goalsLoading && goals.length === 0 && (
            <EmptyState
              icon="🎯"
              title="No goals created"
              description="Create donation or membership goals to track progress and display them on your stream overlay."
              action={
                <button
                  onClick={() => setShowGoalForm(true)}
                  style={{ background: '#10b981', color: '#fff', padding: '10px 20px' }}
                >
                  Create Your First Goal
                </button>
              }
            />
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {goals.map((goal) => {
              const progress = goal.type === 'donation'
                ? BigInt(goal.targetValue) > 0n
                  ? Number((BigInt(goal.currentValue) * 100n) / BigInt(goal.targetValue))
                  : 0
                : parseInt(goal.targetValue, 10) > 0
                  ? Math.round((parseInt(goal.currentValue, 10) * 100) / parseInt(goal.targetValue, 10))
                  : 0;

              return (
                <div
                  key={goal.id}
                  style={{
                    padding: '16px',
                    background: '#1a1a1a',
                    borderRadius: '8px',
                    opacity: goal.enabled ? 1 : 0.6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 600, fontSize: '16px' }}>{goal.name}</span>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            background: goal.type === 'donation' ? '#f59e0b' : '#6366f1',
                            textTransform: 'uppercase',
                            fontWeight: 'bold',
                          }}
                        >
                          {goal.type}
                        </span>
                        {!goal.enabled && (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              background: '#6b7280',
                              textTransform: 'uppercase',
                            }}
                          >
                            Disabled
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: '13px', color: '#888' }}>
                        {goal.type === 'donation'
                          ? `$${formatUSDC(goal.currentValue)} / $${formatUSDC(goal.targetValue)} USDC`
                          : `${goal.currentValue} / ${goal.targetValue} members`}
                        {' '}({Math.min(progress, 100)}%)
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => toggleGoalEnabled(goal.id, !goal.enabled)}
                        style={{
                          background: goal.enabled ? '#6b7280' : '#10b981',
                          color: '#fff',
                          fontSize: '12px',
                          padding: '6px 12px',
                        }}
                      >
                        {goal.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => resetGoal(goal.id)}
                        style={{
                          background: '#3b82f6',
                          color: '#fff',
                          fontSize: '12px',
                          padding: '6px 12px',
                        }}
                      >
                        Reset
                      </button>
                      <button
                        onClick={() => deleteGoal(goal.id)}
                        style={{
                          background: '#ef4444',
                          color: '#fff',
                          fontSize: '12px',
                          padding: '6px 12px',
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div
                    style={{
                      width: '100%',
                      height: '10px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '5px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(progress, 100)}%`,
                        height: '100%',
                        background: goal.type === 'donation'
                          ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                          : 'linear-gradient(90deg, #6366f1, #818cf8)',
                        borderRadius: '5px',
                        transition: 'width 0.3s ease-out',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* New Goal Form Modal */}
          {showGoalForm && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
              }}
              onClick={() => setShowGoalForm(false)}
            >
              <div
                className="card"
                style={{ maxWidth: '400px', width: '90%' }}
                onClick={(e) => e.stopPropagation()}
              >
                <h2 style={{ marginBottom: '16px' }}>Create New Goal</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#888' }}>
                      Goal Type
                    </label>
                    <select
                      value={newGoal.type}
                      onChange={(e) => setNewGoal({ ...newGoal, type: e.target.value as 'donation' | 'membership' })}
                      style={{ width: '100%', padding: '8px', background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: '4px' }}
                    >
                      <option value="donation">Donation (USDC)</option>
                      <option value="membership">Membership (Active Members)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#888' }}>
                      Goal Name
                    </label>
                    <input
                      type="text"
                      value={newGoal.name}
                      onChange={(e) => setNewGoal({ ...newGoal, name: e.target.value })}
                      placeholder="e.g., Stream Goal, 100 Members"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#888' }}>
                      Target {newGoal.type === 'donation' ? '(USDC Amount)' : '(Number of Members)'}
                    </label>
                    <input
                      type="number"
                      value={newGoal.targetValue}
                      onChange={(e) => setNewGoal({ ...newGoal, targetValue: e.target.value })}
                      placeholder={newGoal.type === 'donation' ? 'e.g., 100' : 'e.g., 50'}
                      step={newGoal.type === 'donation' ? '0.01' : '1'}
                      min="0"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
                  <button
                    onClick={() => setShowGoalForm(false)}
                    style={{
                      background: 'transparent',
                      color: '#888',
                      border: '1px solid #333',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createGoal}
                    style={{
                      background: '#10b981',
                      color: '#fff',
                    }}
                  >
                    Create Goal
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reset Demo Confirmation Dialog */}
      {showResetConfirm && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            className="card"
            style={{ maxWidth: '400px', width: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: '12px' }}>Reset Demo Data?</h2>
            <p style={{ color: '#888', marginBottom: '20px' }}>
              This will clear all queued Q&A items and blocked wallets. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowResetConfirm(false)}
                style={{
                  background: 'transparent',
                  color: '#888',
                  border: '1px solid #333',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDemoReset}
                disabled={resetLoading}
                style={{
                  background: '#dc2626',
                  color: '#fff',
                }}
              >
                {resetLoading ? 'Resetting...' : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
