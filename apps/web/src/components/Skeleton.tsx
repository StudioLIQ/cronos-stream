import { CSSProperties } from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: CSSProperties;
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 4,
  style,
  className,
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className || ''}`}
      style={{
        width,
        height,
        borderRadius,
        background: 'linear-gradient(90deg, #1a1a1a 25%, #2a2a2a 50%, #1a1a1a 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.5s infinite',
        ...style,
      }}
    />
  );
}

// Stream card skeleton
export function StreamCardSkeleton() {
  return (
    <div className="stream-card" style={{ pointerEvents: 'none' }}>
      <div className="stream-thumb">
        <Skeleton height={0} style={{ paddingTop: '56.25%', borderRadius: 8 }} />
      </div>
      <div className="stream-meta">
        <Skeleton height={18} width="80%" style={{ marginBottom: 8 }} />
        <Skeleton height={14} width="50%" />
      </div>
    </div>
  );
}

// Action button skeleton
export function ActionButtonSkeleton() {
  return (
    <div
      style={{
        padding: '16px',
        background: '#1a1a1a',
        border: '1px solid #333',
        borderRadius: 6,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <Skeleton width={40} height={40} borderRadius="50%" />
      <Skeleton width={80} height={14} />
      <Skeleton width={60} height={12} />
    </div>
  );
}

// Q&A item skeleton
export function QaItemSkeleton() {
  return (
    <div className="card" style={{ padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Skeleton width={60} height={20} borderRadius={4} />
          <Skeleton width={50} height={20} borderRadius={4} />
        </div>
        <Skeleton width={60} height={14} />
      </div>
      <Skeleton width="40%" height={16} style={{ marginBottom: '8px' }} />
      <Skeleton width="100%" height={14} style={{ marginBottom: '4px' }} />
      <Skeleton width="70%" height={14} />
    </div>
  );
}

// Leaderboard item skeleton
export function LeaderboardItemSkeleton() {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px',
        background: '#1a1a1a',
        borderRadius: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Skeleton width={24} height={14} />
        <div>
          <Skeleton width={120} height={16} style={{ marginBottom: '4px' }} />
          <Skeleton width={80} height={12} />
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <Skeleton width={60} height={16} style={{ marginBottom: '4px' }} />
        <Skeleton width={70} height={12} />
      </div>
    </div>
  );
}

// Member item skeleton
export function MemberItemSkeleton() {
  return (
    <div
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
        <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
          <Skeleton width={50} height={18} borderRadius={4} />
          <Skeleton width={100} height={18} />
        </div>
        <Skeleton width={150} height={12} />
      </div>
      <Skeleton width={60} height={28} borderRadius={4} />
    </div>
  );
}

// Goal item skeleton
export function GoalItemSkeleton() {
  return (
    <div
      style={{
        padding: '16px',
        background: '#1a1a1a',
        borderRadius: '8px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Skeleton width={100} height={18} />
          <Skeleton width={60} height={18} borderRadius={4} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Skeleton width={60} height={28} borderRadius={4} />
          <Skeleton width={50} height={28} borderRadius={4} />
        </div>
      </div>
      <Skeleton width="60%" height={13} style={{ marginBottom: '8px' }} />
      <Skeleton height={10} borderRadius={5} />
    </div>
  );
}
