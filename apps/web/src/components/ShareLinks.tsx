import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { copyToClipboard } from '../lib/clipboard';

interface ShareLinksProps {
  slug: string;
}

export function ShareLinks({ slug }: ShareLinksProps) {
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);

  const baseUrl = window.location.origin;
  const viewerUrl = `${baseUrl}/v/${slug}`;
  const overlayUrl = `${baseUrl}/o/${slug}`;

  const handleCopy = async (url: string, label: string) => {
    const success = await copyToClipboard(url);
    if (success) {
      setCopiedLink(label);
      setTimeout(() => setCopiedLink(null), 2000);
    }
  };

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Share Links</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Viewer Link */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            background: '#1a1a1a',
            borderRadius: '8px',
          }}
        >
          <span style={{ fontSize: '14px', color: '#888', minWidth: '60px' }}>Viewer:</span>
          <code
            style={{
              flex: 1,
              fontSize: '13px',
              color: '#6366f1',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            /v/{slug}
          </code>
          <button
            onClick={() => handleCopy(viewerUrl, 'viewer')}
            style={{
              background: copiedLink === 'viewer' ? '#10b981' : '#3b82f6',
              color: '#fff',
              fontSize: '12px',
              padding: '6px 12px',
              whiteSpace: 'nowrap',
            }}
          >
            {copiedLink === 'viewer' ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* Overlay Link */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            background: '#1a1a1a',
            borderRadius: '8px',
          }}
        >
          <span style={{ fontSize: '14px', color: '#888', minWidth: '60px' }}>Overlay:</span>
          <code
            style={{
              flex: 1,
              fontSize: '13px',
              color: '#f59e0b',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            /o/{slug}
          </code>
          <button
            onClick={() => handleCopy(overlayUrl, 'overlay')}
            style={{
              background: copiedLink === 'overlay' ? '#10b981' : '#3b82f6',
              color: '#fff',
              fontSize: '12px',
              padding: '6px 12px',
              whiteSpace: 'nowrap',
            }}
          >
            {copiedLink === 'overlay' ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* QR Code Toggle */}
      <div style={{ marginTop: '12px' }}>
        <button
          onClick={() => setShowQR(!showQR)}
          style={{
            background: 'transparent',
            color: '#888',
            border: '1px solid #333',
            fontSize: '12px',
            width: '100%',
          }}
        >
          {showQR ? 'Hide QR Code' : 'Show QR Code for Viewers'}
        </button>
      </div>

      {/* QR Code */}
      {showQR && (
        <div
          style={{
            marginTop: '16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              background: '#fff',
              padding: '16px',
              borderRadius: '12px',
            }}
          >
            <QRCodeSVG
              value={viewerUrl}
              size={160}
              level="M"
              includeMargin={false}
            />
          </div>
          <p style={{ fontSize: '12px', color: '#888', textAlign: 'center' }}>
            Scan to open viewer page
          </p>
        </div>
      )}
    </div>
  );
}
