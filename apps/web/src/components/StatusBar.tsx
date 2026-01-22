import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/config';

interface StatusData {
  status: string;
  network: string;
  chainId: number | null;
  serverTime: string;
}

export function StatusBar() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/status`);
        if (res.ok) {
          const data = await res.json();
          setStatusData(data);
          setApiStatus('online');
        } else {
          setApiStatus('offline');
        }
      } catch {
        setApiStatus('offline');
      }
      setLastCheck(new Date());
    };

    checkStatus();
    const interval = setInterval(checkStatus, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const statusColor = apiStatus === 'online' ? '#00f889' : apiStatus === 'offline' ? '#e02020' : '#f2da00';
  const networkLabel = statusData?.network?.includes('testnet') ? 'Testnet' : statusData?.network?.includes('mainnet') ? 'Mainnet' : statusData?.network || 'Unknown';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--topbar-bg)',
        borderTop: '1px solid var(--border)',
        backdropFilter: 'blur(10px)',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '12px',
        color: 'var(--muted)',
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* API Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: statusColor,
              display: 'inline-block',
            }}
          />
          <span>API: {apiStatus === 'online' ? 'Online' : apiStatus === 'offline' ? 'Offline' : 'Checking...'}</span>
        </div>

        {/* Network */}
        {statusData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '11px',
                background: statusData.network?.includes('testnet') ? '#5cbffb' : 'var(--accent)',
                color: 'var(--primary-text)',
              }}
            >
              {networkLabel}
            </span>
            {statusData.chainId && (
              <span style={{ color: 'var(--muted)' }}>Chain {statusData.chainId}</span>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Last check time */}
        {lastCheck && (
          <span style={{ color: 'var(--muted)' }}>
            Last checked: {lastCheck.toLocaleTimeString()}
          </span>
        )}

        {/* Stream402 branding */}
        <span style={{ color: 'var(--muted)' }}>Stream402</span>
      </div>
    </div>
  );
}
