import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchChannel, fetchActions, triggerAction, donate, submitQA, is402Response, fetchMembershipPlans, fetchMembershipStatus, subscribeMembership, fetchMySupports, fetchChannelProfile, fetchGlobalProfileNonce, fetchChannelProfileNonce, updateGlobalProfile, updateChannelProfile } from '../lib/api';
import type { Channel, Action, PaymentResponse, MembershipPlan, MembershipStatus, MembershipResponse, SupportItem, ChannelProfile } from '../lib/api';
import { connectWallet, getSigner, isConnected, switchToCronosTestnet } from '../lib/wallet';
import { createPaymentHeader, formatUsdcAmount } from '../lib/x402';
import { TopNav } from '../components/TopNav';
import { OverlayLayer } from '../components/OverlayLayer';
import { getFeaturedStreamBySlug } from '../data/featuredStreams';
import { toYouTubeEmbedUrl } from '../lib/youtube';
import { useToasts } from '../components/Toast';
import { copyToClipboard } from '../lib/clipboard';
import { ActionButtonSkeleton, Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { useConfetti } from '../hooks/useConfetti';

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
  const { addToast } = useToasts();
  const { fireSuccess } = useConfetti();
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

  // Membership state
  const [membershipPlans, setMembershipPlans] = useState<MembershipPlan[]>([]);
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [membershipState, setMembershipState] = useState<PaymentState>('idle');
  const [membershipResult, setMembershipResult] = useState<MembershipResponse | null>(null);

  // My supports state
  const [mySupports, setMySupports] = useState<SupportItem[]>([]);
  const [mySupportsLoading, setMySupportsLoading] = useState(false);

  // Nickname state
  const [channelProfileData, setChannelProfileData] = useState<ChannelProfile | null>(null);
  const [nicknameLoading, setNicknameLoading] = useState(false);
  const [globalNicknameInput, setGlobalNicknameInput] = useState('');
  const [channelNicknameInput, setChannelNicknameInput] = useState('');
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    const featured = getFeaturedStreamBySlug(slug);
    if (!featured) {
      setLoading(false);
      return;
    }

    Promise.all([fetchChannel(slug), fetchActions(slug), fetchMembershipPlans(slug)])
      .then(([ch, acts, plans]) => {
        setChannel(ch);
        setActions(acts);
        setMembershipPlans(plans);
        if (plans.length > 0) setSelectedPlan(plans[0].id);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [slug]);

  // Fetch membership status when wallet is connected
  useEffect(() => {
    if (!slug || !walletAddress) return;

    fetchMembershipStatus(slug, walletAddress)
      .then((status) => {
        setMembershipStatus(status);
      })
      .catch(() => {
        // Ignore errors for membership status
      });
  }, [slug, walletAddress]);

  // Fetch my supports when wallet is connected
  const refreshMySupports = async () => {
    if (!slug || !walletAddress) return;
    setMySupportsLoading(true);
    try {
      const data = await fetchMySupports(slug, walletAddress, 10);
      setMySupports(data.items);
    } catch {
      // Ignore errors
    } finally {
      setMySupportsLoading(false);
    }
  };

  useEffect(() => {
    refreshMySupports();
  }, [slug, walletAddress]);

  // Fetch profile when wallet is connected
  useEffect(() => {
    if (!slug || !walletAddress) {
      setChannelProfileData(null);
      return;
    }

    setNicknameLoading(true);
    fetchChannelProfile(slug, walletAddress)
      .then((profile) => {
        setChannelProfileData(profile);
        setGlobalNicknameInput(profile.globalDisplayName || '');
        setChannelNicknameInput(profile.channelDisplayNameOverride || '');
      })
      .catch(() => {
        // Ignore errors
      })
      .finally(() => {
        setNicknameLoading(false);
      });
  }, [slug, walletAddress]);

  const handleConnect = async () => {
    try {
      await switchToCronosTestnet();
      const state = await connectWallet();
      setWalletAddress(state.address);
      addToast('Wallet connected successfully', 'success');
    } catch (err) {
      const message = (err as Error).message;
      addToast(message, 'error');
      setError(message);
    }
  };

  const handleCopyTxHash = async (txHash: string) => {
    const success = await copyToClipboard(txHash);
    if (success) {
      addToast('Transaction hash copied to clipboard', 'success');
    } else {
      addToast('Failed to copy to clipboard', 'error');
    }
  };

  const handleSaveGlobalNickname = async () => {
    if (!walletAddress || !globalNicknameInput.trim()) return;
    setNicknameSaving(true);
    setNicknameError(null);

    try {
      // Get nonce
      const nonceData = await fetchGlobalProfileNonce(walletAddress);

      // Sign message
      const signer = getSigner();
      if (!signer) throw new Error('Wallet not connected');

      const message = `Stream402 Global Profile Update

Address: ${walletAddress.toLowerCase()}
Display Name: ${globalNicknameInput.trim()}
Scope: global
Nonce: ${nonceData.nonce}
Issued At: ${nonceData.issuedAt}
Expires At: ${nonceData.expiresAt}`;

      const signature = await signer.signMessage(message);

      // Submit update
      await updateGlobalProfile(
        walletAddress,
        globalNicknameInput.trim(),
        nonceData.nonce,
        nonceData.issuedAt,
        nonceData.expiresAt,
        signature
      );

      // Refresh profile
      if (slug) {
        const profile = await fetchChannelProfile(slug, walletAddress);
        setChannelProfileData(profile);
        setGlobalNicknameInput(profile.globalDisplayName || '');
        setChannelNicknameInput(profile.channelDisplayNameOverride || '');
      }
    } catch (err) {
      setNicknameError((err as Error).message);
    } finally {
      setNicknameSaving(false);
    }
  };

  const handleSaveChannelNickname = async () => {
    if (!walletAddress || !slug || !channelNicknameInput.trim()) return;
    setNicknameSaving(true);
    setNicknameError(null);

    try {
      // Get nonce
      const nonceData = await fetchChannelProfileNonce(slug, walletAddress);

      // Sign message
      const signer = getSigner();
      if (!signer) throw new Error('Wallet not connected');

      const message = `Stream402 Channel Profile Update

Address: ${walletAddress.toLowerCase()}
Channel: ${slug}
Action: set
Display Name Override: ${channelNicknameInput.trim()}
Nonce: ${nonceData.nonce}
Issued At: ${nonceData.issuedAt}
Expires At: ${nonceData.expiresAt}`;

      const signature = await signer.signMessage(message);

      // Submit update
      await updateChannelProfile(
        slug,
        walletAddress,
        'set',
        nonceData.nonce,
        nonceData.issuedAt,
        nonceData.expiresAt,
        signature,
        channelNicknameInput.trim()
      );

      // Refresh profile
      const profile = await fetchChannelProfile(slug, walletAddress);
      setChannelProfileData(profile);
      setGlobalNicknameInput(profile.globalDisplayName || '');
      setChannelNicknameInput(profile.channelDisplayNameOverride || '');
    } catch (err) {
      setNicknameError((err as Error).message);
    } finally {
      setNicknameSaving(false);
    }
  };

  const handleClearChannelNickname = async () => {
    if (!walletAddress || !slug) return;
    setNicknameSaving(true);
    setNicknameError(null);

    try {
      // Get nonce
      const nonceData = await fetchChannelProfileNonce(slug, walletAddress);

      // Sign message
      const signer = getSigner();
      if (!signer) throw new Error('Wallet not connected');

      const message = `Stream402 Channel Profile Update

Address: ${walletAddress.toLowerCase()}
Channel: ${slug}
Action: clear
Nonce: ${nonceData.nonce}
Issued At: ${nonceData.issuedAt}
Expires At: ${nonceData.expiresAt}`;

      const signature = await signer.signMessage(message);

      // Submit update
      await updateChannelProfile(
        slug,
        walletAddress,
        'clear',
        nonceData.nonce,
        nonceData.issuedAt,
        nonceData.expiresAt,
        signature
      );

      // Refresh profile
      const profile = await fetchChannelProfile(slug, walletAddress);
      setChannelProfileData(profile);
      setGlobalNicknameInput(profile.globalDisplayName || '');
      setChannelNicknameInput(profile.channelDisplayNameOverride || '');
    } catch (err) {
      setNicknameError((err as Error).message);
    } finally {
      setNicknameSaving(false);
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
        addToast('Please sign the transaction in your wallet', 'info');

        const signer = getSigner();
        if (!signer) {
          throw new Error('Wallet not connected');
        }

        // Create payment header
        const paymentHeader = await createPaymentHeader(signer, result.paymentRequirements);

        setPaymentState('settling');
        addToast('Settling payment on-chain...', 'info');

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
      addToast('Effect triggered successfully!', 'success');
      fireSuccess();
    } catch (err) {
      const message = (err as Error).message;
      addToast(message, 'error');
      setError(message);
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
        addToast('Please sign the transaction in your wallet', 'info');

        const signer = getSigner();
        if (!signer) {
          throw new Error('Wallet not connected');
        }

        // Create payment header
        const paymentHeader = await createPaymentHeader(signer, result.paymentRequirements);

        setQaState('settling');
        addToast('Settling payment on-chain...', 'info');

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
      addToast('Question submitted successfully!', 'success');
      fireSuccess();
    } catch (err) {
      const message = (err as Error).message;
      addToast(message, 'error');
      setError(message);
      setQaState('error');
    }
  };

  const handleSubscribe = async () => {
    if (!slug || !selectedPlan) return;
    setMembershipState('needs_payment');
    setMembershipResult(null);

    try {
      // First request without payment
      let result = await subscribeMembership(slug, selectedPlan);

      if (is402Response(result)) {
        setMembershipState('signing');
        addToast('Please sign the transaction in your wallet', 'info');

        const signer = getSigner();
        if (!signer) {
          throw new Error('Wallet not connected');
        }

        // Create payment header
        const paymentHeader = await createPaymentHeader(signer, result.paymentRequirements);

        setMembershipState('settling');
        addToast('Settling payment on-chain...', 'info');

        // Retry with payment
        result = await subscribeMembership(slug, selectedPlan, paymentHeader);

        if (is402Response(result)) {
          throw new Error('Payment still required after signing');
        }
      }

      const membershipResponse = result as MembershipResponse;
      setMembershipResult(membershipResponse);
      setMembershipState('done');
      addToast('Membership activated successfully!', 'success');
      fireSuccess();

      // Refresh membership status
      if (walletAddress) {
        const status = await fetchMembershipStatus(slug, walletAddress);
        setMembershipStatus(status);
      }
    } catch (err) {
      const message = (err as Error).message;
      addToast(message, 'error');
      setError(message);
      setMembershipState('error');
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
      addToast(parsed.error, 'warning');
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
        addToast('Please sign the transaction in your wallet', 'info');

        const signer = getSigner();
        if (!signer) {
          throw new Error('Wallet not connected');
        }

        // Create payment header
        const paymentHeader = await createPaymentHeader(signer, result.paymentRequirements);

        setDonationState('settling');
        addToast('Settling payment on-chain...', 'info');

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
      addToast('Thank you for your donation!', 'success');
      fireSuccess();
    } catch (err) {
      const message = (err as Error).message;
      addToast(message, 'error');
      setError(message);
      setDonationState('error');
    }
  };

  if (loading) {
    return (
      <div>
        <TopNav />
        <div className="container">
          <header style={{ marginBottom: '24px' }}>
            <Skeleton width={200} height={28} style={{ marginBottom: 8 }} />
            <Skeleton width={140} height={14} />
          </header>
          <div className="viewer-grid">
            <div className="viewer-main">
              <section>
                <Skeleton width={60} height={22} style={{ marginBottom: 12 }} />
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <Skeleton height={0} style={{ paddingTop: '56.25%' }} borderRadius={0} />
                </div>
              </section>
              <section style={{ marginTop: '24px' }}>
                <Skeleton width={80} height={22} style={{ marginBottom: 12 }} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
                  <ActionButtonSkeleton />
                  <ActionButtonSkeleton />
                  <ActionButtonSkeleton />
                  <ActionButtonSkeleton />
                </div>
              </section>
            </div>
            <aside className="viewer-side">
              <section>
                <Skeleton width={100} height={22} style={{ marginBottom: 12 }} />
                <div className="card">
                  <Skeleton height={100} />
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  const featured = slug ? getFeaturedStreamBySlug(slug) : undefined;
  const featuredEmbedUrl = featured ? toYouTubeEmbedUrl(featured.youtube.url) : null;
  const featuredAutoplayUrl = featuredEmbedUrl
    ? (() => {
        try {
          const url = new URL(featuredEmbedUrl);
          url.searchParams.set('autoplay', '1');
          url.searchParams.set('mute', '1');
          url.searchParams.set('playsinline', '1');
          return url.toString();
        } catch {
          return featuredEmbedUrl;
        }
      })()
    : null;

  if (!featured || !featuredAutoplayUrl) {
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
                  src={featuredAutoplayUrl}
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
                {slug && <OverlayLayer slug={slug} />}
              </div>
            </div>
          </section>

          <section style={{ marginTop: '24px' }}>
            <h2>Effects</h2>
            <p style={{ marginTop: '8px', color: '#888', fontSize: '14px' }}>
              Effects appear on the streamer overlay: <a href={`/o/${slug}`} style={{ color: '#3b82f6' }}>/o/{slug}</a>
            </p>
            {actions.length === 0 ? (
              <div className="card" style={{ marginTop: '12px' }}>
                <EmptyState
                  icon="🎬"
                  title="No effects available"
                  description="This channel hasn't set up any paid effects yet. Check back later or try the donation or Q&A features."
                />
              </div>
            ) : (
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
            )}

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
                      <button
                        onClick={() => handleCopyTxHash(lastResult.txHash)}
                        style={{ marginLeft: '8px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: '12px' }}
                      >
                        Copy
                      </button>
                    </>
                  )}
                  {paymentState === 'error' && 'Error occurred'}
                </p>
              </div>
            )}
          </section>
        </div>

        <aside className="viewer-side">
          {/* Membership Section */}
          {membershipPlans.length === 0 && (
            <section>
              <h2>Membership</h2>
              <div className="card" style={{ marginTop: '12px' }}>
                <EmptyState
                  icon="🎖️"
                  title="No membership plans"
                  description="This channel hasn't set up membership tiers yet. You can still support them with donations and Q&A."
                />
              </div>
            </section>
          )}
          {membershipPlans.length > 0 && (
            <section>
              <h2>Membership</h2>
              <div className="card" style={{ marginTop: '12px' }}>
                {membershipStatus?.active ? (
                  <div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '12px',
                    }}>
                      <span style={{
                        padding: '4px 8px',
                        background: '#10b981',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                      }}>
                        MEMBER
                      </span>
                      <span style={{ color: '#888', fontSize: '14px' }}>
                        {membershipStatus.membership?.planName}
                      </span>
                    </div>
                    <p style={{ color: '#888', fontSize: '14px' }}>
                      Expires: {membershipStatus.membership?.expiresAt ?
                        new Date(membershipStatus.membership.expiresAt).toLocaleDateString() : 'N/A'}
                    </p>
                    <button
                      onClick={handleSubscribe}
                      disabled={!isConnected() || membershipState === 'signing' || membershipState === 'settling'}
                      style={{ marginTop: '12px', background: '#6366f1', color: '#fff', width: '100%' }}
                    >
                      {membershipState === 'signing'
                        ? 'Signing...'
                        : membershipState === 'settling'
                        ? 'Settling...'
                        : 'Renew Membership'}
                    </button>
                  </div>
                ) : (
                  <div>
                    <p style={{ color: '#888', fontSize: '14px', marginBottom: '12px' }}>
                      Join as a member to support this channel!
                    </p>

                    {membershipPlans.length > 1 && (
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '14px' }}>
                          Select Plan
                        </label>
                        <select
                          value={selectedPlan || ''}
                          onChange={(e) => setSelectedPlan(e.target.value)}
                          style={{ width: '100%' }}
                        >
                          {membershipPlans.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.name} - ${formatUsdcAmount(plan.priceBaseUnits)} ({plan.durationDays} days)
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {membershipPlans.length === 1 && (
                      <p style={{ marginBottom: '12px', fontWeight: 500 }}>
                        {membershipPlans[0].name}: ${formatUsdcAmount(membershipPlans[0].priceBaseUnits)} for {membershipPlans[0].durationDays} days
                      </p>
                    )}

                    <button
                      onClick={handleSubscribe}
                      disabled={!isConnected() || !selectedPlan || membershipState === 'signing' || membershipState === 'settling'}
                      style={{ background: '#6366f1', color: '#fff', width: '100%' }}
                    >
                      {membershipState === 'signing'
                        ? 'Signing...'
                        : membershipState === 'settling'
                        ? 'Settling...'
                        : 'Subscribe'}
                    </button>
                  </div>
                )}

                {membershipState === 'done' && membershipResult && (
                  <p style={{ marginTop: '12px', color: '#10b981' }}>
                    Success! TX:{' '}
                    <a
                      href={`https://explorer.cronos.org/testnet/tx/${membershipResult.payment.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#3b82f6' }}
                    >
                      {membershipResult.payment.txHash.slice(0, 10)}...
                    </a>
                  </p>
                )}
              </div>
            </section>
          )}

          <section style={{ marginTop: membershipPlans.length > 0 ? '24px' : 0 }}>
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

          {/* My Supports Section */}
          {isConnected() && (
            <section style={{ marginTop: '24px' }}>
              <h2>My Supports</h2>
              <div className="card" style={{ marginTop: '12px' }}>
                {mySupportsLoading && <p style={{ color: '#888' }}>Loading...</p>}

                {!mySupportsLoading && mySupports.length === 0 && (
                  <p style={{ color: '#888', fontSize: '14px' }}>
                    No supports yet. Support this channel!
                  </p>
                )}

                {!mySupportsLoading && mySupports.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {mySupports.map((support) => (
                      <div
                        key={support.paymentId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px',
                          background: '#1a1a1a',
                          borderRadius: '6px',
                        }}
                      >
                        <div>
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
                                  : support.kind === 'membership'
                                  ? '#6366f1'
                                  : '#6b7280',
                            }}
                          >
                            {support.kind || 'effect'}
                          </span>
                          {support.timestamp && (
                            <span style={{ fontSize: '12px', color: '#888' }}>
                              {new Date(support.timestamp * 1000).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontWeight: 'bold', color: '#10b981' }}>
                            ${formatUsdcAmount(support.value)}
                          </span>
                          {support.txHash && (
                            <a
                              href={`https://explorer.cronos.org/testnet/tx/${support.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ marginLeft: '8px', fontSize: '11px', color: '#6366f1' }}
                            >
                              tx
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={refreshMySupports}
                  style={{
                    marginTop: '12px',
                    background: 'transparent',
                    color: '#888',
                    border: '1px solid #333',
                    fontSize: '12px',
                    width: '100%',
                  }}
                >
                  Refresh
                </button>
              </div>
            </section>
          )}

          {/* Nickname Section */}
          {isConnected() && (
            <section style={{ marginTop: '24px' }}>
              <h2>Nickname</h2>
              <div className="card" style={{ marginTop: '12px' }}>
                {nicknameLoading ? (
                  <p style={{ color: '#888' }}>Loading...</p>
                ) : (
                  <>
                    {/* Effective nickname preview */}
                    <div style={{ marginBottom: '16px', padding: '12px', background: '#1a1a1a', borderRadius: '6px' }}>
                      <p style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>Your display name:</p>
                      <p style={{ fontSize: '16px', fontWeight: 600 }}>
                        {channelProfileData?.effectiveDisplayName || walletAddress?.slice(0, 6) + '...' + walletAddress?.slice(-4)}
                      </p>
                      <p style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                        {channelProfileData?.channelDisplayNameOverride
                          ? '(channel override)'
                          : channelProfileData?.globalDisplayName
                          ? '(global)'
                          : '(wallet address)'}
                      </p>
                    </div>

                    {nicknameError && (
                      <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px' }}>{nicknameError}</p>
                    )}

                    {/* Global nickname editor */}
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '14px' }}>
                        Global Nickname
                      </label>
                      <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
                        Used across all channels unless overridden
                      </p>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={globalNicknameInput}
                          onChange={(e) => setGlobalNicknameInput(e.target.value)}
                          placeholder="2-20 characters"
                          maxLength={20}
                          style={{ flex: 1 }}
                          disabled={nicknameSaving}
                        />
                        <button
                          onClick={handleSaveGlobalNickname}
                          disabled={nicknameSaving || !globalNicknameInput.trim()}
                          style={{ background: '#3b82f6', color: '#fff', whiteSpace: 'nowrap' }}
                        >
                          {nicknameSaving ? 'Signing...' : 'Save'}
                        </button>
                      </div>
                    </div>

                    {/* Channel override editor */}
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', color: '#888', fontSize: '14px' }}>
                        Channel Override
                      </label>
                      <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
                        Optional: Use a different name for this channel only
                      </p>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          value={channelNicknameInput}
                          onChange={(e) => setChannelNicknameInput(e.target.value)}
                          placeholder="2-20 characters"
                          maxLength={20}
                          style={{ flex: 1 }}
                          disabled={nicknameSaving}
                        />
                        <button
                          onClick={handleSaveChannelNickname}
                          disabled={nicknameSaving || !channelNicknameInput.trim()}
                          style={{ background: '#6366f1', color: '#fff', whiteSpace: 'nowrap' }}
                        >
                          {nicknameSaving ? 'Signing...' : 'Set'}
                        </button>
                      </div>
                      {channelProfileData?.channelDisplayNameOverride && (
                        <button
                          onClick={handleClearChannelNickname}
                          disabled={nicknameSaving}
                          style={{
                            marginTop: '8px',
                            background: 'transparent',
                            color: '#888',
                            border: '1px solid #333',
                            fontSize: '12px',
                            width: '100%',
                          }}
                        >
                          {nicknameSaving ? 'Signing...' : 'Reset to Global'}
                        </button>
                      )}
                    </div>

                    <p style={{ fontSize: '11px', color: '#666', marginTop: '16px' }}>
                      Nickname changes require a wallet signature (no payment).
                    </p>
                  </>
                )}
              </div>
            </section>
          )}
        </aside>
      </div>
      </div>
    </div>
  );
}
