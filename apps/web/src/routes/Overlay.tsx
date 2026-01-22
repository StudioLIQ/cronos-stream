import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { OverlayLayer } from '../components/OverlayLayer';
import { QRCodeSVG } from 'qrcode.react';

export default function Overlay() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const showQR = searchParams.get('qr') === '1';
  const qrPosition = searchParams.get('qrpos') || 'br'; // br, bl, tr, tl

  useEffect(() => {
    if (!slug) return;
    const prevHtmlBackground = document.documentElement.style.background;
    const prevBodyBackground = document.body.style.background;
    const prevBodyMargin = document.body.style.margin;

    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';

    return () => {
      document.documentElement.style.background = prevHtmlBackground;
      document.body.style.background = prevBodyBackground;
      document.body.style.margin = prevBodyMargin;
    };
  }, [slug]);

  if (!slug) return null;

  const viewerUrl = `${window.location.origin}/v/${slug}`;

  const qrPositionStyles: Record<string, React.CSSProperties> = {
    br: { bottom: '24px', right: '24px' },
    bl: { bottom: '24px', left: '24px' },
    tr: { top: '24px', right: '24px' },
    tl: { top: '24px', left: '24px' },
  };

  return (
    <>
      <OverlayLayer slug={slug} position="fixed" />

      {/* QR Code Overlay */}
      {showQR && (
        <div
          style={{
            position: 'fixed',
            ...qrPositionStyles[qrPosition] || qrPositionStyles.br,
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: '12px',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
            }}
          >
            <QRCodeSVG
              value={viewerUrl}
              size={120}
              level="M"
              includeMargin={false}
            />
          </div>
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.8)',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            Scan to Support
          </div>
        </div>
      )}
    </>
  );
}
