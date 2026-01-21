import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { fetchChannel, fetchActions, triggerAction, donate, submitQA, is402Response } from '../lib/api';
import type { Channel, Action, PaymentResponse } from '../lib/api';
import { connectWallet, getSigner, isConnected, switchToCronosTestnet } from '../lib/wallet';
import { createPaymentHeader, formatUsdcAmount } from '../lib/x402';
import { TopNav } from '../components/TopNav';

type PaymentState = 'idle' | 'needs_payment' | 'signing' | 'settling' | 'done' | 'error';

interface PaymentResult {
  txHash: string;
  from: string;
  value: string;
}

const DEFAULT_STREAM_INPUT = 'https://www.youtube.com/watch?v=Ap-UM1O9RBU';
const DEFAULT_STREAM_EMBED_URL = 'https://www.youtube.com/embed/Ap-UM1O9RBU';

function parseUsdcToBaseUnits(input: string): { ok: true; baseUnits: string } | { ok: false; error: string } {
  let normalized = input.trim();
  if (!normalized) return { ok: false, error: 'Please enter a donation amount.' };

  if (normalized.startsWith('.')) normalized = `0${normalized}`;
  if (normalized.endsWith('.')) normalized = normalized.slice(0, -1);

  if (!/^\d+(\.\d{0,6})?$/.test(normalized)) {
    return { ok: false, error: 'Invalid amount format. Example: 0.05' };
  }

  const [wholePart, fractionalPart = ''] = normalized.split('.');
  const whole = BigInt(wholePart || '0');
  const fractionalPadded = fractionalPart.padEnd(6, '0');
  const fractional = BigInt(fractionalPadded || '0');

  const baseUnits = (whole * 1_000_000n + fractional).toString();
  if (BigInt(baseUnits) <= 0n) return { ok: false, error: 'Donation amount must be greater than 0.' };

  return { ok: true, baseUnits };
}

function normalizeYouTubeStreamInput(value: string): { ok: true; embedUrl: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: 'Please enter a link.' };

  // YouTube channel ID (preferred for "currently live" embeds)
  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
    return {
      ok: true,
      embedUrl: `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(trimmed)}`,
    };
  }

  // YouTube video ID (11 chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return { ok: true, embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(trimmed)}` };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid URL.' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Only https URLs are supported.' };
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const videoId = url.pathname.replace(/^\//, '').split('/')[0];
    if (!videoId) return { ok: false, error: 'Invalid youtu.be URL.' };
    return { ok: true, embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` };
  }

  if (host === 'youtube.com') {
    if (url.pathname.startsWith('/embed/')) {
      return { ok: true, embedUrl: url.toString() };
    }

    if (url.pathname === '/watch') {
      const videoId = url.searchParams.get('v');
      if (!videoId) return { ok: false, error: 'The watch URL must include the v= parameter.' };
      return { ok: true, embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` };
    }

    if (url.pathname.startsWith('/live/')) {
      const videoId = url.pathname.split('/')[2];
      if (!videoId) return { ok: false, error: 'Invalid /live URL.' };
      return { ok: true, embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` };
    }

    if (url.pathname.startsWith('/channel/')) {
      const channelId = url.pathname.split('/')[2];
      if (!channelId) return { ok: false, error: 'Invalid /channel URL.' };
      return {
        ok: true,
        embedUrl: `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channelId)}`,
      };
    }
  }

  if (host === 'youtube-nocookie.com') {
    if (url.pathname.startsWith('/embed/')) {
      return { ok: true, embedUrl: url.toString() };
    }
  }

  return { ok: false, error: 'Only YouTube links (channel/video) are supported.' };
}

function streamOverrideEmbedKey(slug: string): string {
  return `stream402:streamEmbedUrlOverride:${slug}`;
}

function streamOverrideInputKey(slug: string): string {
  return `stream402:streamInputOverride:${slug}`;
}

export default function Viewer() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stream embed override (local only)
  const [streamOverrideEmbedUrl, setStreamOverrideEmbedUrl] = useState<string | null>(null);
  const [streamInput, setStreamInput] = useState('');
  const [streamInputError, setStreamInputError] = useState<string | null>(null);

  // Donation state
  const [donationAmount, setDonationAmount] = useState('0.05');
  const [donationDisplayName, setDonationDisplayName] = useState('');
  const [donationMessage, setDonationMessage] = useState('');
  const [donationState, setDonationState] = useState<PaymentState>('idle');
  const [donationResult, setDonationResult] = useState<PaymentResult | null>(null);
  const [donationAmountError, setDonationAmountError] = useState<string | null>(null);

  // Action trigger state
  const [paymentState, setPaymentState] = useState<PaymentState>('idle');
  const [lastResult, setLastResult] = useState<PaymentResult | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  // Q&A state
  const [qaMessage, setQaMessage] = useState('');
  const [qaDisplayName, setQaDisplayName] = useState('');
  const [qaTier, setQaTier] = useState<'normal' | 'priority'>('normal');
  const [qaState, setQaState] = useState<PaymentState>('idle');
  const [qaResult, setQaResult] = useState<PaymentResult | null>(null);

  useEffect(() => {
    if (!slug) return;

    Promise.all([fetchChannel(slug), fetchActions(slug)])
      .then(([ch, acts]) => {
        setChannel(ch);
        setActions(acts);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const storedEmbedUrl = localStorage.getItem(streamOverrideEmbedKey(slug));
    const storedInput = localStorage.getItem(streamOverrideInputKey(slug));
    setStreamOverrideEmbedUrl(storedEmbedUrl || null);
    setStreamInput(storedInput || '');
    setStreamInputError(null);
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const params = new URLSearchParams(location.search);
    const streamParam = params.get('stream');
    if (!streamParam) return;

    setStreamInput(streamParam);
    const normalized = normalizeYouTubeStreamInput(streamParam);
    if (!normalized.ok) {
      setStreamInputError(normalized.error);
      return;
    }

    localStorage.setItem(streamOverrideEmbedKey(slug), normalized.embedUrl);
    localStorage.setItem(streamOverrideInputKey(slug), streamParam);
    setStreamOverrideEmbedUrl(normalized.embedUrl);
    setStreamInputError(null);
  }, [slug, location.search]);

  const handleConnect = async () => {
    try {
      await switchToCronosTestnet();
      const state = await connectWallet();
      setWalletAddress(state.address);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleTriggerAction = async (actionKey: string) => {
    if (!slug) return;
    setActiveAction(actionKey);
    setPaymentState('needs_payment');
    setLastResult(null);

    try {
      // First request without payment
      let result = await triggerAction(slug, actionKey);

      if (is402Response(result)) {
        setPaymentState('signing');

        const signer = getSigner();
        if (!signer) {
          throw new Error('Wallet not connected');
        }

        // Create payment header
        const paymentHeader = await createPaymentHeader(signer, result.paymentRequirements);

        setPaymentState('settling');

        // Retry with payment
        result = await triggerAction(slug, actionKey, paymentHeader);

        if (is402Response(result)) {
          throw new Error('Payment still required after signing');
        }
      }

      const paymentResult = result as PaymentResponse;
      setLastResult({
        txHash: paymentResult.payment.txHash,
        from: paymentResult.payment.from,
        value: paymentResult.payment.value,
      });
      setPaymentState('done');
    } catch (err) {
      setError((err as Error).message);
      setPaymentState('error');
    }
  };

  const handleSubmitQA = async () => {
    if (!slug || !qaMessage.trim()) return;
    setQaState('needs_payment');
    setQaResult(null);

    try {
      // First request without payment
      let result = await submitQA(slug, qaMessage.trim(), qaDisplayName.trim() || null, qaTier);

      if (is402Response(result)) {
        setQaState('signing');

        const signer = getSigner();
        if (!signer) {
          throw new Error('Wallet not connected');
        }

        // Create payment header
        const paymentHeader = await createPaymentHeader(signer, result.paymentRequirements);

        setQaState('settling');

        // Retry with payment
        result = await submitQA(slug, qaMessage.trim(), qaDisplayName.trim() || null, qaTier, paymentHeader);

        if (is402Response(result)) {
          throw new Error('Payment still required after signing');
        }
      }

      const paymentResult = result as PaymentResponse;
      setQaResult({
        txHash: paymentResult.payment.txHash,
        from: paymentResult.payment.from,
        value: paymentResult.payment.value,
      });
      setQaState('done');
      setQaMessage('');
    } catch (err) {
      setError((err as Error).message);
      setQaState('error');
    }
  };

  const handleDonate = async () => {
    if (!slug) return;

    setDonationState('needs_payment');
    setDonationResult(null);
    setDonationAmountError(null);

    const parsed = parseUsdcToBaseUnits(donationAmount);
    if (!parsed.ok) {
      setDonationAmountError(parsed.error);
      setDonationState('idle');
      return;
    }

    try {
      // First request without payment
      let result = await donate(
        slug,
        parsed.baseUnits,
        donationMessage.trim() || null,
        donationDisplayName.trim() || null
      );

      if (is402Response(result)) {
        setDonationState('signing');

        const signer = getSigner();
        if (!signer) {
          throw new Error('Wallet not connected');
        }

        // Create payment header
        const paymentHeader = await createPaymentHeader(signer, result.paymentRequirements);

        setDonationState('settling');

        // Retry with payment
        result = await donate(
          slug,
          parsed.baseUnits,
          donationMessage.trim() || null,
          donationDisplayName.trim() || null,
          paymentHeader
        );

        if (is402Response(result)) {
          throw new Error('Payment still required after signing');
        }
      }

      const paymentResult = result as PaymentResponse;
      setDonationResult({
        txHash: paymentResult.payment.txHash,
        from: paymentResult.payment.from,
        value: paymentResult.payment.value,
      });
      setDonationState('done');
      setDonationMessage('');
    } catch (err) {
      setError((err as Error).message);
      setDonationState('error');
    }
  };

  const activeStreamEmbedUrl =
    streamOverrideEmbedUrl || channel?.streamEmbedUrl || DEFAULT_STREAM_EMBED_URL;

  const handleApplyStream = () => {
    if (!slug) return;
    const value = streamInput.trim();
    if (!value) {
      localStorage.removeItem(streamOverrideEmbedKey(slug));
      localStorage.removeItem(streamOverrideInputKey(slug));
      setStreamOverrideEmbedUrl(null);
      setStreamInputError(null);
      return;
    }

    const normalized = normalizeYouTubeStreamInput(value);
    if (!normalized.ok) {
      setStreamInputError(normalized.error);
      return;
    }

    localStorage.setItem(streamOverrideEmbedKey(slug), normalized.embedUrl);
    localStorage.setItem(streamOverrideInputKey(slug), value);
    setStreamOverrideEmbedUrl(normalized.embedUrl);
    setStreamInputError(null);
  };

  const handleResetStream = () => {
    if (!slug) return;
    localStorage.removeItem(streamOverrideEmbedKey(slug));
    localStorage.removeItem(streamOverrideInputKey(slug));
    setStreamOverrideEmbedUrl(null);
    setStreamInput('');
    setStreamInputError(null);
  };

  if (loading) {
    return <div className="container"><p>Loading...</p></div>;
  }

  if (!channel) {
    return <div className="container"><p>Channel not found</p></div>;
  }

  return (
    <div>
      <TopNav />
      <div className="container">
      <header style={{ marginBottom: '24px' }}>
        <h1>{channel.displayName}</h1>
        <p style={{ color: '#888', fontSize: '14px' }}>Network: {channel.network}</p>

        {!isConnected() ? (
          <button
            onClick={handleConnect}
            style={{ marginTop: '12px', background: '#3b82f6', color: '#fff' }}
          >
            Connect Wallet
          </button>
        ) : (
          <p style={{ marginTop: '12px', color: '#10b981', fontSize: '14px' }}>
            Connected: {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
          </p>
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

      <div className="viewer-grid">
        <div className="viewer-main">
          <section>
            <h2>Live</h2>
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: '12px' }}>
              <div style={{ position: 'relative', paddingTop: '56.25%' }}>
                <iframe
                  src={activeStreamEmbedUrl}
                  title={`${channel.displayName} livestream`}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    border: 0,
                  }}
                />
              </div>
            </div>

            <div className="card" style={{ marginTop: '12px' }}>
              <p style={{ color: '#888', fontSize: '14px', lineHeight: 1.4 }}>
                This defaults to the demo video. Paste a YouTube live/video link below to change it (saved <strong>only in this browser</strong>).
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={streamInput}
                  onChange={(e) => setStreamInput(e.target.value)}
                  placeholder={DEFAULT_STREAM_INPUT}
                  style={{ width: '100%' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleApplyStream();
                  }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={handleApplyStream} style={{ background: '#3b82f6', color: '#fff' }}>
                    Apply
                  </button>
                  <button onClick={handleResetStream} style={{ background: '#1a1a1a', color: '#fff', border: '1px solid #333' }}>
                    Reset
                  </button>
                </div>
              </div>
              {streamInputError && (
                <p style={{ marginTop: '10px', color: '#ef4444', fontSize: '13px' }}>
                  {streamInputError}
                </p>
              )}
            </div>
          </section>

          <section style={{ marginTop: '24px' }}>
            <h2>Effects</h2>
            <p style={{ marginTop: '8px', color: '#888', fontSize: '14px' }}>
              Effects appear on the streamer overlay: <a href={`/o/${slug}`} style={{ color: '#3b82f6' }}>/o/{slug}</a>
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginTop: '12px' }}>
              {actions.map((action) => (
                <button
                  key={action.actionKey}
                  onClick={() => handleTriggerAction(action.actionKey)}
                  disabled={!isConnected() || paymentState === 'signing' || paymentState === 'settling'}
                  style={{
                    padding: '16px',
                    background: activeAction === action.actionKey && paymentState !== 'idle' && paymentState !== 'done' ? '#f59e0b' : '#1a1a1a',
                    color: '#fff',
                    border: '1px solid #333',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ fontSize: '24px' }}>
                    {action.type === 'sticker' ? '🖼️' : action.type === 'sound' ? '🔊' : '⚡'}
                  </span>
                  <span>{action.actionKey}</span>
                  <span style={{ fontSize: '12px', color: '#888' }}>
                    ${formatUsdcAmount(action.priceBaseUnits)} USDC
                  </span>
                </button>
              ))}
            </div>

            {paymentState !== 'idle' && (
              <div className="card" style={{ marginTop: '16px' }}>
                <p>
                  {paymentState === 'needs_payment' && 'Requesting payment...'}
                  {paymentState === 'signing' && 'Please sign the transaction...'}
                  {paymentState === 'settling' && 'Settling payment...'}
                  {paymentState === 'done' && lastResult && (
                    <>
                      Success! TX:{' '}
                      <a
                        href={`https://explorer.cronos.org/testnet/tx/${lastResult.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#3b82f6' }}
                      >
                        {lastResult.txHash.slice(0, 10)}...
                      </a>
                    </>
                  )}
                  {paymentState === 'error' && 'Error occurred'}
                </p>
              </div>
            )}
          </section>
        </div>

        <aside className="viewer-side">
          <section>
            <h2>Donate</h2>
            <div className="card" style={{ marginTop: '12px' }}>
              <p style={{ color: '#888', fontSize: '14px', lineHeight: 1.4 }}>
                Donate while watching the stream. Amounts are in USDC; choose a preset or enter a custom amount.
              </p>

              <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                {[
                  { label: '$0.05', value: '0.05' },
                  { label: '$0.25', value: '0.25' },
                  { label: '$1.00', value: '1' },
                  { label: '$5.00', value: '5' },
                ].map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => {
                      setDonationAmount(preset.value);
                      setDonationAmountError(null);
                    }}
                    style={{
                      background: donationAmount === preset.value ? '#3b82f6' : '#1a1a1a',
                      color: '#fff',
                      border: '1px solid #333',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: '12px' }}>
                <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '14px' }}>
                  Amount (USDC)
                </label>
                <input
                  type="text"
                  value={donationAmount}
                  onChange={(e) => setDonationAmount(e.target.value)}
                  placeholder="0.05"
                  style={{ width: '100%' }}
                />
                {donationAmountError && (
                  <p style={{ marginTop: '8px', color: '#ef4444', fontSize: '13px' }}>
                    {donationAmountError}
                  </p>
                )}
              </div>

              <div style={{ marginTop: '12px' }}>
                <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '14px' }}>
                  Display Name (optional)
                </label>
                <input
                  type="text"
                  value={donationDisplayName}
                  onChange={(e) => setDonationDisplayName(e.target.value)}
                  placeholder="Anonymous"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginTop: '12px' }}>
                <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '14px' }}>
                  Message (optional)
                </label>
                <textarea
                  value={donationMessage}
                  onChange={(e) => setDonationMessage(e.target.value)}
                  placeholder="Say something..."
                  rows={2}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              <button
                onClick={handleDonate}
                disabled={!isConnected() || donationState === 'signing' || donationState === 'settling'}
                style={{ marginTop: '12px', background: '#f59e0b', color: '#000', width: '100%' }}
              >
                {donationState === 'signing'
                  ? 'Signing...'
                  : donationState === 'settling'
                  ? 'Settling...'
                  : `Donate $${donationAmount}`}
              </button>

              {donationState !== 'idle' && (
                <div className="card" style={{ marginTop: '12px' }}>
                  <p>
                    {donationState === 'needs_payment' && 'Requesting payment...'}
                    {donationState === 'signing' && 'Please sign the transaction...'}
                    {donationState === 'settling' && 'Settling payment...'}
                    {donationState === 'done' && donationResult && (
                      <>
                        Thanks! TX:{' '}
                        <a
                          href={`https://explorer.cronos.org/testnet/tx/${donationResult.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#3b82f6' }}
                        >
                          {donationResult.txHash.slice(0, 10)}...
                        </a>
                      </>
                    )}
                    {donationState === 'error' && 'Error occurred'}
                  </p>
                </div>
              )}
            </div>
          </section>

          <section style={{ marginTop: '24px' }}>
            <h2>Ask a Question</h2>
            <div className="card" style={{ marginTop: '12px' }}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '14px' }}>
                  Display Name (optional)
                </label>
                <input
                  type="text"
                  value={qaDisplayName}
                  onChange={(e) => setQaDisplayName(e.target.value)}
                  placeholder="Anonymous"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '14px' }}>
                  Your Question
                </label>
                <textarea
                  value={qaMessage}
                  onChange={(e) => setQaMessage(e.target.value)}
                  placeholder="Type your question..."
                  rows={3}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '14px' }}>
                  Tier
                </label>
                <select
                  value={qaTier}
                  onChange={(e) => setQaTier(e.target.value as 'normal' | 'priority')}
                  style={{ width: '100%' }}
                >
                  <option value="normal">Normal - $0.25 USDC</option>
                  <option value="priority">Priority - $0.50 USDC</option>
                </select>
              </div>

              <button
                onClick={handleSubmitQA}
                disabled={!isConnected() || !qaMessage.trim() || qaState === 'signing' || qaState === 'settling'}
                style={{ background: '#10b981', color: '#fff', width: '100%' }}
              >
                {qaState === 'signing' ? 'Signing...' : qaState === 'settling' ? 'Settling...' : 'Submit Question'}
              </button>

              {qaState === 'done' && qaResult && (
                <p style={{ marginTop: '12px', color: '#10b981' }}>
                  Question submitted! TX:{' '}
                  <a
                    href={`https://explorer.cronos.org/testnet/tx/${qaResult.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#3b82f6' }}
                  >
                    {qaResult.txHash.slice(0, 10)}...
                  </a>
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
      </div>
    </div>
  );
}
