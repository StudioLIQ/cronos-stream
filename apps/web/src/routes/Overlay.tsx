import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { connectSSE } from '../lib/sse';

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
  expiresAt: number;
}

export default function Overlay() {
  const { slug } = useParams<{ slug: string }>();
  const [activeStickers, setActiveStickers] = useState<ActiveSticker[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<ActiveQuestion | null>(null);
  const [flashColor, setFlashColor] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!slug) return;

    const eventSource = connectSSE(`/api/channels/${slug}/stream/overlay`, (eventName, data) => {
      if (eventName === 'effect.triggered') {
        const event = data as EffectEvent;
        handleEffect(event);
      } else if (eventName === 'qa.show') {
        const event = data as QaShowEvent;
        handleQaShow(event);
      }
    });

    return () => {
      eventSource.close();
    };
  }, [slug]);

  // Cleanup expired stickers
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActiveStickers((prev) => prev.filter((s) => s.expiresAt > now));

      if (activeQuestion && activeQuestion.expiresAt < now) {
        setActiveQuestion(null);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [activeQuestion]);

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
      expiresAt: Date.now() + 15000, // Show for 15 seconds
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
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
          {activeQuestion.displayName && (
            <p style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
              {activeQuestion.displayName}
            </p>
          )}
          <p style={{ fontSize: '24px', fontWeight: 500, lineHeight: 1.4 }}>
            {activeQuestion.message}
          </p>
          <p style={{ fontSize: '14px', marginTop: '12px', opacity: 0.8 }}>
            {activeQuestion.tier === 'priority' ? 'Priority Question' : 'Q&A'}
          </p>
        </div>
      )}

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
      `}</style>
    </div>
  );
}
