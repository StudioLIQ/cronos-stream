import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchChannel, fetchActions, triggerAction, donate, submitQA, is402Response } from '../lib/api';
import type { Channel, Action, PaymentResponse } from '../lib/api';
import { connectWallet, getSigner, isConnected, switchToCronosTestnet } from '../lib/wallet';
import { createPaymentHeader, formatUsdcAmount } from '../lib/x402';
import { TopNav } from '../components/TopNav';
import { getFeaturedStreamBySlug } from '../data/featuredStreams';
import { toYouTubeEmbedUrl } from '../lib/youtube';

type PaymentState = 'idle' | 'needs_payment' | 'signing' | 'settling' | 'done' | 'error';

interface PaymentResult {
  txHash: string;
  from: string;
  value: string;
}

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

export default function Viewer() {
  const { slug } = useParams<{ slug: string }>();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

    const featured = getFeaturedStreamBySlug(slug);
    if (!featured) {
      setLoading(false);
      return;
    }

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

  if (loading) {
    return (
      <div>
        <TopNav />
        <div className="container"><p>Loading...</p></div>
      </div>
    );
  }

  const featured = slug ? getFeaturedStreamBySlug(slug) : undefined;
  const featuredEmbedUrl = featured ? toYouTubeEmbedUrl(featured.youtube.url) : null;

  if (!featured || !featuredEmbedUrl) {
    return (
      <div>
        <TopNav />
        <div className="container">
          <div className="card">
            <h2 style={{ fontSize: '18px', fontWeight: 700 }}>Stream not available</h2>
            <p style={{ marginTop: '8px', color: '#888' }}>This stream is not in the featured list.</p>
            <div style={{ marginTop: '14px' }}>
              <Link to="/" style={{ color: '#3b82f6' }}>
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!channel) {
    return (
      <div>
        <TopNav />
        <div className="container"><p>Channel not found</p></div>
      </div>
    );
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
                  src={featuredEmbedUrl}
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
