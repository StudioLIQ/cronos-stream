import { useEffect, useRef, useState } from 'react';
import { connectSSE } from '../lib/sse';
import { formatUsdcAmount } from '../lib/x402';

interface EffectEvent {
  eventId: string;
  actionKey: string;
  type: 'sticker' | 'sound' | 'flash';
  payload: {
    imageUrl?: string;
    audioUrl?: string;
    color?: string;
    durationMs?: number;
  };
  amount: string;
  from: string;
  txHash: string;
  timestamp: number;
}

interface QaShowEvent {
  qaId: string;
  message: string;
  tier: string;
  displayName: string | null;
  isMember?: boolean;
}

interface DonationReceivedEvent {
  donationId: string;
  amount: string;
  message: string | null;
  displayName: string | null;
  from: string;
  txHash: string;
  timestamp: number;
}

interface SupportAlertEvent {
  kind: 'effect' | 'qa' | 'donation' | 'membership';
  value: string;
  fromAddress: string;
  displayName?: string | null;
  txHash: string;
  timestamp: number;
  actionKey?: string;
  qaId?: string;
  membershipPlanId?: string;
}

interface ActiveSticker {
  id: string;
  imageUrl: string;
  expiresAt: number;
}

interface ActiveQuestion {
  id: string;
  message: string;
  displayName: string | null;
  tier: string;
  isMember: boolean;
  expiresAt: number;
}

interface ActiveDonation {
  id: string;
  amount: string;
  message: string | null;
  displayName: string | null;
  from: string;
  txHash: string;
  expiresAt: number;
}

interface ActiveSupportAlert {
  id: string;
  kind: 'effect' | 'qa' | 'donation' | 'membership';
  value: string;
  displayName: string | null;
  fromAddress: string;
  expiresAt: number;
}

export type OverlayLayerProps = {
  slug: string;
  /**
   * Allows positioning the overlay relative to a parent container (default `absolute`).
   * Use `fixed` when rendering as a full-screen overlay page (e.g. OBS browser source).
   */
  position?: 'absolute' | 'fixed';
  /**
   * Optional z-index for layering over video/other elements.
   */
  zIndex?: number;
};

const SUPPORT_ALERT_DURATION = 5000; // 5 seconds
const MAX_VISIBLE_ALERTS = 3;

export function OverlayLayer({ slug, position = 'absolute', zIndex = 10 }: OverlayLayerProps) {
  const [activeStickers, setActiveStickers] = useState<ActiveSticker[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<ActiveQuestion | null>(null);
  const [activeDonation, setActiveDonation] = useState<ActiveDonation | null>(null);
  const [flashColor, setFlashColor] = useState<string | null>(null);
  const [supportAlerts, setSupportAlerts] = useState<ActiveSupportAlert[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const alertIdCounter = useRef(0);

  useEffect(() => {
    const eventSource = connectSSE(`/api/channels/${slug}/stream/overlay`, (eventName, data) => {
      if (eventName === 'effect.triggered') {
        handleEffect(data as EffectEvent);
      } else if (eventName === 'qa.show') {
        handleQaShow(data as QaShowEvent);
      } else if (eventName === 'donation.received') {
        handleDonation(data as DonationReceivedEvent);
      } else if (eventName === 'support.alert') {
        handleSupportAlert(data as SupportAlertEvent);
      }
    });

    return () => {
      eventSource.close();
    };
  }, [slug]);

  // Cleanup expired stickers and alerts
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActiveStickers((prev) => prev.filter((s) => s.expiresAt > now));
      setSupportAlerts((prev) => prev.filter((a) => a.expiresAt > now));

      if (activeQuestion && activeQuestion.expiresAt < now) {
        setActiveQuestion(null);
      }

      if (activeDonation && activeDonation.expiresAt < now) {
        setActiveDonation(null);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [activeQuestion, activeDonation]);

  const handleEffect = (event: EffectEvent) => {
    const duration = event.payload.durationMs || 3000;

    switch (event.type) {
      case 'sticker':
        if (event.payload.imageUrl) {
          setActiveStickers((prev) => [
            ...prev,
            {
              id: event.eventId,
              imageUrl: event.payload.imageUrl!,
              expiresAt: Date.now() + duration,
            },
          ]);
        }
        break;

      case 'flash':
        setFlashColor(event.payload.color || '#ffffff');
        setTimeout(() => setFlashColor(null), duration);
        break;

      case 'sound':
        if (event.payload.audioUrl) {
          if (audioRef.current) {
            audioRef.current.pause();
          }
          const audio = new Audio(event.payload.audioUrl);
          audioRef.current = audio;
          audio.play().catch(console.error);
        }
        break;
    }
  };

  const handleQaShow = (event: QaShowEvent) => {
    setActiveQuestion({
      id: event.qaId,
      message: event.message,
      displayName: event.displayName,
      tier: event.tier,
      isMember: event.isMember || false,
      expiresAt: Date.now() + 15000,
    });
  };

  const handleDonation = (event: DonationReceivedEvent) => {
    setActiveDonation({
      id: event.donationId,
      amount: event.amount,
      message: event.message,
      displayName: event.displayName,
      from: event.from,
      txHash: event.txHash,
      expiresAt: Date.now() + 12000,
    });
  };

  const handleSupportAlert = (event: SupportAlertEvent) => {
    const alertId = `support-${alertIdCounter.current++}`;
    const newAlert: ActiveSupportAlert = {
      id: alertId,
      kind: event.kind,
      value: event.value,
      displayName: event.displayName || null,
      fromAddress: event.fromAddress,
      expiresAt: Date.now() + SUPPORT_ALERT_DURATION,
    };

    setSupportAlerts((prev) => {
      // Keep only the most recent alerts up to MAX_VISIBLE_ALERTS
      const updated = [...prev, newAlert];
      if (updated.length > MAX_VISIBLE_ALERTS) {
        return updated.slice(-MAX_VISIBLE_ALERTS);
      }
      return updated;
    });
  };

  const getKindLabel = (kind: string): string => {
    switch (kind) {
      case 'effect': return 'Effect';
      case 'qa': return 'Q&A';
      case 'donation': return 'Donation';
      case 'membership': return 'Membership';
      default: return 'Support';
    }
  };

  const getKindColor = (kind: string): string => {
    switch (kind) {
      case 'effect': return '#10b981';
      case 'qa': return '#3b82f6';
      case 'donation': return '#f59e0b';
      case 'membership': return '#6366f1';
      default: return '#6b7280';
    }
  };

  return (
    <div
      style={{
        position,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex,
      }}
    >
      {/* Flash effect */}
      {flashColor && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: flashColor,
            opacity: 0.8,
            animation: 'flash-fade 0.5s ease-out',
          }}
        />
      )}

      {/* Stickers */}
      {activeStickers.map((sticker, index) => (
        <div
          key={sticker.id}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) translate(${(index - activeStickers.length / 2) * 120}px, 0)`,
            animation: 'sticker-pop 0.3s ease-out',
          }}
        >
          <img
            src={sticker.imageUrl}
            alt="sticker"
            style={{
              width: '100px',
              height: '100px',
              objectFit: 'contain',
            }}
          />
        </div>
      ))}

      {/* Question highlight */}
      {activeQuestion && (
        <div
          style={{
            position: 'absolute',
            bottom: '100px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: activeQuestion.tier === 'priority' ? 'rgba(245, 158, 11, 0.95)' : 'rgba(59, 130, 246, 0.95)',
            color: '#fff',
            padding: '24px 48px',
            borderRadius: '16px',
            maxWidth: '80%',
            textAlign: 'center',
            animation: 'question-slide 0.5s ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
            {activeQuestion.displayName && (
              <span style={{ fontSize: '18px', fontWeight: 600 }}>
                {activeQuestion.displayName}
              </span>
            )}
            {activeQuestion.isMember && (
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  background: 'rgba(99, 102, 241, 0.9)',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                }}
              >
                Member
              </span>
            )}
          </div>
          <p style={{ fontSize: '24px', fontWeight: 500, lineHeight: 1.4 }}>
            {activeQuestion.message}
          </p>
          <p style={{ fontSize: '14px', marginTop: '12px', opacity: 0.8 }}>
            {activeQuestion.tier === 'priority' ? 'Priority Question' : 'Q&A'}
          </p>
        </div>
      )}

      {/* Donation alert */}
      {activeDonation && (
        <div
          style={{
            position: 'absolute',
            top: '60px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(17, 24, 39, 0.95)',
            color: '#fff',
            padding: '18px 28px',
            borderRadius: '16px',
            border: '2px solid #f59e0b',
            maxWidth: '80%',
            textAlign: 'center',
            animation: 'donation-pop 0.5s ease-out',
          }}
        >
          <p style={{ fontSize: '24px', fontWeight: 700, marginBottom: '6px' }}>
            Donation ${formatUsdcAmount(activeDonation.amount)} USDC
          </p>
          <p style={{ fontSize: '16px', opacity: 0.9 }}>
            {activeDonation.displayName || `${activeDonation.from.slice(0, 6)}...${activeDonation.from.slice(-4)}`}
          </p>
          {activeDonation.message && (
            <p style={{ fontSize: '18px', marginTop: '10px', lineHeight: 1.4 }}>
              {activeDonation.message}
            </p>
          )}
        </div>
      )}

      {/* Support alert toasts (top-right corner) */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxWidth: '320px',
        }}
      >
        {supportAlerts.map((alert) => (
          <div
            key={alert.id}
            style={{
              background: 'rgba(17, 24, 39, 0.95)',
              color: '#fff',
              padding: '12px 16px',
              borderRadius: '10px',
              borderLeft: `4px solid ${getKindColor(alert.kind)}`,
              animation: 'alert-slide-in 0.3s ease-out',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: getKindColor(alert.kind),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                flexShrink: 0,
              }}
            >
              {alert.kind === 'effect' && '✨'}
              {alert.kind === 'qa' && '❓'}
              {alert.kind === 'donation' && '💰'}
              {alert.kind === 'membership' && '⭐'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>
                {getKindLabel(alert.kind)}
              </p>
              <p style={{ fontSize: '12px', opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {alert.displayName || `${alert.fromAddress.slice(0, 6)}...${alert.fromAddress.slice(-4)}`}
              </p>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <p style={{ fontSize: '14px', fontWeight: 700, color: '#10b981' }}>
                ${formatUsdcAmount(alert.value)}
              </p>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes flash-fade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }

        @keyframes sticker-pop {
          0% { transform: translate(-50%, -50%) scale(0); }
          50% { transform: translate(-50%, -50%) scale(1.2); }
          100% { transform: translate(-50%, -50%) scale(1); }
        }

        @keyframes question-slide {
          0% { transform: translateX(-50%) translateY(100px); opacity: 0; }
          100% { transform: translateX(-50%) translateY(0); opacity: 1; }
        }

        @keyframes donation-pop {
          0% { transform: translateX(-50%) translateY(-20px) scale(0.9); opacity: 0; }
          100% { transform: translateX(-50%) translateY(0) scale(1); opacity: 1; }
        }

        @keyframes alert-slide-in {
          0% { transform: translateX(100px); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

