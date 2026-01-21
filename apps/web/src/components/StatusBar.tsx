import { useEffect, useState } from 'react';

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
        const res = await fetch('/api/status');
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

  const statusColor = apiStatus === 'online' ? '#10b981' : apiStatus === 'offline' ? '#ef4444' : '#f59e0b';
  const networkLabel = statusData?.network?.includes('testnet') ? 'Testnet' : statusData?.network?.includes('mainnet') ? 'Mainnet' : statusData?.network || 'Unknown';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'rgba(17, 24, 39, 0.95)',
        borderTop: '1px solid #2a2a2a',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '12px',
        color: '#888',
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
                background: statusData.network?.includes('testnet') ? '#6366f1' : '#10b981',
              }}
            >
              {networkLabel}
            </span>
            {statusData.chainId && (
              <span style={{ color: '#666' }}>Chain {statusData.chainId}</span>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Last check time */}
        {lastCheck && (
          <span style={{ color: '#666' }}>
            Last checked: {lastCheck.toLocaleTimeString()}
          </span>
        )}

        {/* Stream402 branding */}
        <span style={{ color: '#555' }}>Stream402</span>
      </div>
    </div>
  );
}
