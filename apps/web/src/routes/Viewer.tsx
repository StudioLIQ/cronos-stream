import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  fetchChannel,
  fetchChannelWallet,
  fetchActions,
  fetchStreamStatus,
  triggerAction,
  donate,
  submitQA,
  is402Response,
  fetchMembershipPlans,
  fetchMembershipStatus,
  subscribeMembership,
  fetchMySupports,
  fetchPublicReceipt,
} from '../lib/api';
import type {
  Channel,
  ChannelWallet,
  Action,
  StreamStatusResponse,
  PaymentResponse,
  MembershipPlan,
  MembershipStatus,
  MembershipResponse,
  SupportItem,
  PaymentReceipt,
} from '../lib/api';
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
import { useWallet } from '../contexts/WalletContext';
import { formatWalletSignatureError } from '../lib/walletErrors';

type PaymentState = 'idle' | 'needs_payment' | 'signing' | 'settling' | 'done' | 'error';
type SupportKind = 'donation' | 'qa';

interface PaymentResult {
  txHash: string;
  from: string;
  value: string;
}

function formatAddress(address: string): string {
  if (!address) return '—';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
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
  const navigate = useNavigate();
  const { addToast } = useToasts();
  const { fireSuccess } = useConfetti();
  const {
    address: walletAddress,
    signer: walletSigner,
    isConnected: isWalletConnected,
    isConnecting: isWalletConnecting,
    connect: connectWallet,
	  } = useWallet();
	  const [channel, setChannel] = useState<Channel | null>(null);
	  const [channelWallet, setChannelWallet] = useState<ChannelWallet | null>(null);
	  const [isChannelWalletLoading, setIsChannelWalletLoading] = useState(false);
	  const [actions, setActions] = useState<Action[]>([]);
	  const [streamStatus, setStreamStatus] = useState<StreamStatusResponse | null>(null);
	  const [loading, setLoading] = useState(true);
	  const [error, setError] = useState<string | null>(null);

  // Support state (Donate + Q&A)
  const [supportKind, setSupportKind] = useState<SupportKind>('donation');
  const [supportDisplayName, setSupportDisplayName] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportState, setSupportState] = useState<PaymentState>('idle');
  const [supportResult, setSupportResult] = useState<PaymentResult | null>(null);
  const [donationAmount, setDonationAmount] = useState('0.05');
  const [donationAmountError, setDonationAmountError] = useState<string | null>(null);

  // Action trigger state
  const [paymentState, setPaymentState] = useState<PaymentState>('idle');
  const [lastResult, setLastResult] = useState<PaymentResult | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const [qaTier, setQaTier] = useState<'normal' | 'priority'>('normal');

  useEffect(() => {
    setSupportState('idle');
    setSupportResult(null);
    setDonationAmountError(null);
  }, [supportKind]);

  const handleConnectWallet = async () => {
    try {
      await connectWallet();
      addToast('Wallet connected successfully', 'success');
    } catch (err) {
      addToast((err as Error).message, 'error');
    }
  };

  // Membership state
  const [membershipPlans, setMembershipPlans] = useState<MembershipPlan[]>([]);
  const [membershipStatus, setMembershipStatus] = useState<MembershipStatus | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [membershipState, setMembershipState] = useState<PaymentState>('idle');
  const [membershipResult, setMembershipResult] = useState<MembershipResponse | null>(null);

  // My supports state
  const [mySupports, setMySupports] = useState<SupportItem[]>([]);
  const [mySupportsLoading, setMySupportsLoading] = useState(false);
  const [mySupportsNextCursor, setMySupportsNextCursor] = useState<string | null>(null);
  const [mySupportsLoadingMore, setMySupportsLoadingMore] = useState(false);

  // Receipt state
  const [expandedReceipt, setExpandedReceipt] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<PaymentReceipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);

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

	  // Best-effort channel wallet USDC balance (public; refreshes every 15s)
	  useEffect(() => {
	    if (!slug) return;

	    let cancelled = false;

	    const refresh = async () => {
	      setIsChannelWalletLoading(true);
	      try {
	        const data = await fetchChannelWallet(slug);
	        if (cancelled) return;
	        setChannelWallet(data);
	      } catch {
	        if (cancelled) return;
	        setChannelWallet(null);
	      } finally {
	        if (cancelled) return;
	        setIsChannelWalletLoading(false);
	      }
	    };

	    refresh();
	    const id = window.setInterval(refresh, 15_000);

	    return () => {
	      cancelled = true;
	      window.clearInterval(id);
	    };
	  }, [slug]);

	  // Best-effort stream status (used to resolve live_stream -> concrete videoId, and block entry if offline)
	  useEffect(() => {
	    if (!slug) return;

    let cancelled = false;
    setStreamStatus(null);

    fetchStreamStatus(slug)
      .then((status) => {
        if (cancelled) return;
        setStreamStatus(status);
      })
      .catch(() => {
        if (cancelled) return;
        setStreamStatus({ ok: true, status: 'unknown', checkedAt: new Date().toISOString() });
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!slug || !streamStatus || !streamStatus.ok) return;
    if (streamStatus.status === 'offline' || streamStatus.status === 'unconfigured') {
      addToast('Stream is offline right now', 'warning');
      navigate('/', { replace: true });
    }
  }, [slug, streamStatus, addToast, navigate]);

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
      const data = await fetchMySupports(slug, walletAddress, { limit: 10 });
      setMySupports(data.items);
      setMySupportsNextCursor(data.nextCursor);
    } catch {
      // Ignore errors
    } finally {
      setMySupportsLoading(false);
    }
  };

  const loadMoreSupports = async () => {
    if (!slug || !walletAddress || !mySupportsNextCursor || mySupportsLoadingMore) return;
    setMySupportsLoadingMore(true);
    try {
      const data = await fetchMySupports(slug, walletAddress, { limit: 10, cursor: mySupportsNextCursor });
      setMySupports((prev) => [...prev, ...data.items]);
      setMySupportsNextCursor(data.nextCursor);
    } catch {
      // Ignore errors
    } finally {
      setMySupportsLoadingMore(false);
    }
  };

  const handleViewReceipt = async (paymentId: string) => {
    if (!slug || !walletAddress) return;

    // Toggle off if already expanded
    if (expandedReceipt === paymentId) {
      setExpandedReceipt(null);
      setReceiptData(null);
      return;
    }

    setExpandedReceipt(paymentId);
    setReceiptLoading(true);
    setReceiptError(null);
    setReceiptData(null);

    try {
      const data = await fetchPublicReceipt(slug, paymentId, walletAddress);
      setReceiptData(data);
    } catch (err) {
      setReceiptError((err as Error).message);
    } finally {
      setReceiptLoading(false);
    }
  };

  useEffect(() => {
    refreshMySupports();
  }, [slug, walletAddress]);

	  const handleCopyTxHash = async (txHash: string) => {
	    const success = await copyToClipboard(txHash);
	    if (success) {
	      addToast('Transaction hash copied to clipboard', 'success');
    } else {
      addToast('Failed to copy to clipboard', 'error');
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

        const signer = walletSigner;
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
      // Auto-refresh My Supports after successful payment
      refreshMySupports();
    } catch (err) {
      const message = formatWalletSignatureError(err);
      addToast(message, 'error');
      setError(message);
      setPaymentState('error');
    }
  };

  const handleSubmitSupport = async () => {
    if (!slug) return;

    setSupportState('needs_payment');
    setSupportResult(null);
    setDonationAmountError(null);

    const kind = supportKind;
    const displayName = supportDisplayName.trim() || null;
    const message = supportMessage.trim();

    let donationBaseUnits: string | null = null;

    if (kind === 'donation') {
      const parsed = parseUsdcToBaseUnits(donationAmount);
      if (!parsed.ok) {
        setDonationAmountError(parsed.error);
        setSupportState('idle');
        addToast(parsed.error, 'warning');
        return;
      }
      donationBaseUnits = parsed.baseUnits;
    }

    if (kind === 'qa' && !message) {
      setSupportState('idle');
      addToast('Please enter a question.', 'warning');
      return;
    }

    try {
      // First request without payment
      let result =
        kind === 'donation'
          ? await donate(slug, donationBaseUnits as string, message || null, displayName)
          : await submitQA(slug, message, displayName, qaTier);

      if (is402Response(result)) {
        setSupportState('signing');
        addToast('Please sign the transaction in your wallet', 'info');

        const signer = walletSigner;
        if (!signer) {
          throw new Error('Wallet not connected');
        }

        // Create payment header
        const paymentHeader = await createPaymentHeader(signer, result.paymentRequirements);

        setSupportState('settling');
        addToast('Settling payment on-chain...', 'info');

        // Retry with payment
        result =
          kind === 'donation'
            ? await donate(slug, donationBaseUnits as string, message || null, displayName, paymentHeader)
            : await submitQA(slug, message, displayName, qaTier, paymentHeader);

        if (is402Response(result)) {
          throw new Error('Payment still required after signing');
        }
      }

      const paymentResult = result as PaymentResponse;
      setSupportResult({
        txHash: paymentResult.payment.txHash,
        from: paymentResult.payment.from,
        value: paymentResult.payment.value,
      });
      setSupportState('done');
      setSupportMessage('');
      addToast(kind === 'donation' ? 'Thank you for your donation!' : 'Question submitted successfully!', 'success');
      fireSuccess();
      // Auto-refresh My Supports after successful payment
      refreshMySupports();
    } catch (err) {
      const message = formatWalletSignatureError(err);
      addToast(message, 'error');
      setError(message);
      setSupportState('error');
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

        const signer = walletSigner;
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
      // Auto-refresh My Supports after successful payment
      refreshMySupports();
    } catch (err) {
      const message = formatWalletSignatureError(err);
      addToast(message, 'error');
      setError(message);
      setMembershipState('error');
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
	              {isWalletConnected && (
	                <section style={{ marginTop: '24px' }}>
	                  <Skeleton width={110} height={22} style={{ marginBottom: 12 }} />
	                  <div className="card">
	                    <Skeleton height={110} />
	                  </div>
	                </section>
	              )}
	            </div>
	            <aside className="viewer-side">
	              <section>
	                <Skeleton width={80} height={22} style={{ marginBottom: 12 }} />
	                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
	                  <ActionButtonSkeleton />
	                  <ActionButtonSkeleton />
	                  <ActionButtonSkeleton />
	                  <ActionButtonSkeleton />
	                </div>
	              </section>
	              <section style={{ marginTop: '24px' }}>
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
	  const resolvedEmbed = streamStatus?.ok && streamStatus.status === 'live' ? streamStatus.embedUrl : null;
	  const streamInput = resolvedEmbed || channel?.streamEmbedUrl || featured?.youtube.url || null;
  const embedUrl = streamInput ? toYouTubeEmbedUrl(streamInput) : null;
  const autoplayUrl = embedUrl
    ? (() => {
        try {
          const url = new URL(embedUrl);
          url.searchParams.set('autoplay', '1');
          url.searchParams.set('mute', '1');
          url.searchParams.set('playsinline', '1');
          return url.toString();
        } catch {
          return embedUrl;
        }
      })()
    : null;

	  if (!channel) {
	    return (
	      <div>
	        <TopNav />
	        <div className="container"><p>Channel not found</p></div>
      </div>
    );
	  }

	  const channelBalanceLabel = channelWallet?.usdcBalanceBaseUnits
	    ? `$${formatUsdcAmount(channelWallet.usdcBalanceBaseUnits)} USDC`
	    : isChannelWalletLoading
	      ? '$… USDC'
	      : '$— USDC';

	  const handleCopyChannelWallet = async () => {
	    const ok = await copyToClipboard(channel.payToAddress);
	    addToast(ok ? 'Copied channel wallet address' : 'Failed to copy channel wallet address', ok ? 'success' : 'error');
	  };

	  return (
	    <div>
	      <TopNav />
		      <div className="container">
			      <header style={{ marginBottom: '24px' }}>
			        <h1>{channel.displayName}</h1>
			        <p style={{ color: 'var(--muted)', fontSize: '14px' }}>Network: {channel.network}</p>
			        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px' }}>
			          <button
			            onClick={handleCopyChannelWallet}
			            title={channel.payToAddress}
			            style={{
			              background: 'transparent',
			              border: '1px solid var(--border)',
			              padding: '8px 12px',
			              borderRadius: '999px',
			              fontSize: '13px',
			              color: 'var(--muted)',
			            }}
			          >
			            Wallet: {formatAddress(channel.payToAddress)} Copy
			          </button>
			          <div
			            title={channelWallet?.usdcBalanceError || undefined}
			            style={{
			              background: 'var(--panel-2)',
			              border: '1px solid var(--border)',
			              padding: '8px 12px',
			              borderRadius: '999px',
			              fontSize: '13px',
			              color: 'var(--text)',
			              userSelect: 'none',
			            }}
			          >
			            {channelBalanceLabel}
			          </div>
			        </div>
			      </header>

		      {error && (
		        <div className="card" style={{ background: 'var(--danger)', color: '#fff', marginBottom: '16px' }}>
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
                {autoplayUrl ? (
                  <iframe
                    src={autoplayUrl}
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
	                ) : (
	                  <div
	                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
	                      justifyContent: 'center',
	                      padding: '16px',
	                      textAlign: 'center',
	                      color: 'var(--muted)',
	                      background: 'var(--panel-2)',
	                    }}
	                  >
	                    <div>
	                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>No stream configured</div>
	                      <div style={{ marginTop: '6px', fontSize: '14px' }}>
	                        Ask the streamer to set a stream URL (YouTube channel ID is best for stable live links).
	                      </div>
	                    </div>
	                  </div>
	                )}
	                {slug && <OverlayLayer slug={slug} />}
	              </div>
	            </div>
	          </section>

	          {/* My Supports Section */}
	          {isWalletConnected && (
	            <section style={{ marginTop: '24px' }}>
	              <h2>My Supports</h2>
	              <div className="card" style={{ marginTop: '12px' }}>
	                {mySupportsLoading && <p style={{ color: 'var(--muted)' }}>Loading...</p>}

	                {!mySupportsLoading && mySupports.length === 0 && (
	                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
	                    No supports yet. Support this channel!
	                  </p>
	                )}

	                {!mySupportsLoading && mySupports.length > 0 && (
	                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
	                    {mySupports.map((support) => (
	                      <div key={support.paymentId}>
	                        <div
	                          style={{
	                            display: 'flex',
	                            justifyContent: 'space-between',
	                            alignItems: 'center',
	                            padding: '8px',
	                            background: 'var(--panel-2)',
	                            borderRadius: expandedReceipt === support.paymentId ? '6px 6px 0 0' : '6px',
	                          }}
	                        >
	                          <div>
	                            <span
	                              style={{
	                                padding: '2px 6px',
	                                borderRadius: '4px',
	                                fontSize: '11px',
	                                marginRight: '8px',
	                                color: 'var(--primary-text)',
	                                background:
	                                  support.kind === 'donation'
	                                    ? '#f2da00'
	                                    : support.kind === 'qa'
	                                    ? '#5cbffb'
	                                    : support.kind === 'membership'
	                                    ? 'var(--accent)'
	                                    : '#9da5b6',
	                              }}
	                            >
	                              {support.kind || 'effect'}
	                            </span>
	                            {support.timestamp && (
	                              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
	                                {new Date(support.timestamp * 1000).toLocaleDateString()}
	                              </span>
	                            )}
	                          </div>
	                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
	                            <span style={{ fontWeight: 'bold', color: 'var(--accent)' }}>
	                              ${formatUsdcAmount(support.value)}
	                            </span>
	                            <button
	                              onClick={() => handleViewReceipt(support.paymentId)}
	                              style={{
	                                background: 'transparent',
	                                border: '1px solid var(--border)',
	                                color: 'var(--muted)',
	                                padding: '2px 8px',
	                                fontSize: '11px',
	                                cursor: 'pointer',
	                              }}
	                            >
	                              {expandedReceipt === support.paymentId ? 'Hide' : 'Details'}
	                            </button>
	                          </div>
	                        </div>
	                        {expandedReceipt === support.paymentId && (
	                          <div
	                            style={{
	                              padding: '12px',
	                              background: 'var(--panel)',
	                              borderRadius: '0 0 6px 6px',
	                              borderTop: '1px solid var(--border)',
	                              fontSize: '12px',
	                            }}
	                          >
	                            {receiptLoading && <p style={{ color: 'var(--muted)' }}>Loading receipt...</p>}
	                            {receiptError && <p style={{ color: 'var(--danger)' }}>{receiptError}</p>}
	                            {receiptData && (
	                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
	                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
	                                  <span style={{ color: 'var(--muted)' }}>Status:</span>
	                                  <span style={{ color: receiptData.status === 'settled' ? 'var(--accent)' : 'var(--text)' }}>
	                                    {receiptData.status}
	                                  </span>
	                                </div>
	                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
	                                  <span style={{ color: 'var(--muted)' }}>Network:</span>
	                                  <span>{receiptData.network}</span>
	                                </div>
	                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
	                                  <span style={{ color: 'var(--muted)' }}>Amount:</span>
	                                  <span>${formatUsdcAmount(receiptData.value)} USDC</span>
	                                </div>
	                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
	                                  <span style={{ color: 'var(--muted)' }}>From:</span>
	                                  <span style={{ fontFamily: 'monospace' }}>{receiptData.fromAddress.slice(0, 10)}...</span>
	                                </div>
	                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
	                                  <span style={{ color: 'var(--muted)' }}>To:</span>
	                                  <span style={{ fontFamily: 'monospace' }}>{receiptData.toAddress.slice(0, 10)}...</span>
	                                </div>
	                                {receiptData.txHash && (
	                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
	                                    <span style={{ color: 'var(--muted)' }}>Transaction:</span>
	                                    <a
	                                      href={`https://explorer.cronos.org/testnet/tx/${receiptData.txHash}`}
	                                      target="_blank"
	                                      rel="noopener noreferrer"
	                                      style={{ color: 'var(--accent-text)' }}
	                                    >
	                                      {receiptData.txHash.slice(0, 10)}...
	                                    </a>
	                                  </div>
	                                )}
	                                {receiptData.blockNumber && (
	                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
	                                    <span style={{ color: 'var(--muted)' }}>Block:</span>
	                                    <span>{receiptData.blockNumber}</span>
	                                  </div>
	                                )}
	                                {receiptData.timestamp && (
	                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
	                                    <span style={{ color: 'var(--muted)' }}>Time:</span>
	                                    <span>{new Date(receiptData.timestamp * 1000).toLocaleString()}</span>
	                                  </div>
	                                )}
	                                {receiptData.actionKey && (
	                                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
	                                    <span style={{ color: 'var(--muted)' }}>Action:</span>
	                                    <span>{receiptData.actionKey}</span>
	                                  </div>
	                                )}
	                              </div>
	                            )}
	                          </div>
	                        )}
	                      </div>
	                    ))}
	                  </div>
	                )}

	                {/* Load more button */}
	                {!mySupportsLoading && mySupportsNextCursor && (
	                  <button
	                    onClick={loadMoreSupports}
	                    disabled={mySupportsLoadingMore}
	                    style={{
	                      marginTop: '12px',
	                      background: 'transparent',
	                      color: 'var(--accent-text)',
	                      border: '1px solid var(--border)',
	                      fontSize: '12px',
	                      width: '100%',
	                    }}
	                  >
	                    {mySupportsLoadingMore ? 'Loading...' : 'Load More'}
	                  </button>
	                )}

	                {/* Keep existing refresh button but only show when no more items to load */}
	                {!mySupportsLoading && !mySupportsNextCursor && mySupports.length > 0 && (
	                  <button
	                    onClick={refreshMySupports}
	                    style={{
	                      marginTop: '12px',
	                      background: 'transparent',
	                      color: 'var(--muted)',
	                      border: '1px solid var(--border)',
	                      fontSize: '12px',
	                      width: '100%',
	                    }}
	                  >
	                    Refresh
	                  </button>
	                )}
	              </div>
	            </section>
	          )}
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
	                {!isWalletConnected ? (
	                  <div>
	                    <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '12px' }}>
	                      Connect your wallet to subscribe.
	                    </p>
	                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
	                      {membershipPlans.map((plan) => (
	                        <div
	                          key={plan.id}
	                          style={{
	                            display: 'flex',
	                            justifyContent: 'space-between',
	                            alignItems: 'center',
	                            padding: '10px 12px',
	                            background: 'var(--panel-2)',
	                            border: '1px solid var(--border)',
	                            borderRadius: '8px',
	                            fontSize: '13px',
	                          }}
	                        >
	                          <span style={{ fontWeight: 600 }}>{plan.name}</span>
	                          <span style={{ color: 'var(--muted)' }}>${formatUsdcAmount(plan.priceBaseUnits)}</span>
	                        </div>
	                      ))}
	                    </div>
	                    <button
	                      onClick={handleConnectWallet}
	                      disabled={isWalletConnecting}
	                      style={{
	                        marginTop: '12px',
	                        background: 'var(--primary)',
	                        color: 'var(--primary-text)',
	                        width: '100%',
	                      }}
	                    >
	                      {isWalletConnecting ? 'Connecting...' : 'Connect Wallet'}
	                    </button>
	                  </div>
	                ) : (
	                  <div>
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
	                        background: 'var(--accent)',
	                        color: 'var(--primary-text)',
	                        borderRadius: '4px',
	                        fontSize: '12px',
	                        fontWeight: 'bold',
	                      }}>
	                        MEMBER
	                      </span>
	                      <span style={{ color: 'var(--muted)', fontSize: '14px' }}>
	                        {membershipStatus.membership?.planName}
	                      </span>
	                    </div>
	                    <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
	                      Member Since:{' '}
	                      {membershipStatus.membership?.memberSince
	                        ? new Date(membershipStatus.membership.memberSince).toLocaleDateString()
	                        : '—'}
	                    </p>
	                    <button
	                      onClick={handleSubscribe}
	                      disabled={!isWalletConnected || membershipState === 'signing' || membershipState === 'settling'}
	                      style={{ marginTop: '12px', background: 'var(--primary)', color: 'var(--primary-text)', width: '100%' }}
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
	                    <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '12px' }}>
	                      Join as a member to support this channel!
	                    </p>

                    {membershipPlans.length > 1 && (
                      <div style={{ marginBottom: '12px' }}>
	                        <label style={{ display: 'block', marginBottom: '4px', color: 'var(--muted)', fontSize: '14px' }}>
	                          Select Plan
	                        </label>
                        <select
                          value={selectedPlan || ''}
                          onChange={(e) => setSelectedPlan(e.target.value)}
                          style={{ width: '100%' }}
                        >
                          {membershipPlans.map((plan) => (
                            <option key={plan.id} value={plan.id}>
                              {plan.name} - ${formatUsdcAmount(plan.priceBaseUnits)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {membershipPlans.length === 1 && (
                      <p style={{ marginBottom: '12px', fontWeight: 500 }}>
                        {membershipPlans[0].name}: ${formatUsdcAmount(membershipPlans[0].priceBaseUnits)}
                      </p>
                    )}

	                    <button
	                      onClick={handleSubscribe}
	                      disabled={!isWalletConnected || !selectedPlan || membershipState === 'signing' || membershipState === 'settling'}
	                      style={{ background: 'var(--primary)', color: 'var(--primary-text)', width: '100%' }}
	                    >
                      {membershipState === 'signing'
                        ? 'Signing...'
                        : membershipState === 'settling'
                        ? 'Settling...'
                        : 'Subscribe'}
                    </button>
                  </div>
                )}

	                {membershipState === 'done' && membershipResult && membershipResult.payment.txHash && (
	                  <p style={{ marginTop: '12px', color: 'var(--accent)' }}>
	                    Success! TX:{' '}
	                    <a
	                      href={`https://explorer.cronos.org/testnet/tx/${membershipResult.payment.txHash}`}
	                      target="_blank"
	                      rel="noopener noreferrer"
	                      style={{ color: 'var(--accent-text)' }}
	                    >
	                      {membershipResult.payment.txHash.slice(0, 10)}...
	                    </a>
	                  </p>
	                )}
                  {membershipState === 'done' && membershipResult && !membershipResult.payment.txHash && (
                    <p style={{ marginTop: '12px', color: 'var(--accent)' }}>
                      Success!
	                    </p>
	                  )}
		              </div>
	                )}
	              </div>
	            </section>
	          )}

	          <section style={{ marginTop: '24px' }}>
	            <h2>Effects</h2>
	            {actions.length === 0 ? (
	              <div className="card" style={{ marginTop: '12px' }}>
	                <EmptyState
	                  icon="🎬"
	                  title="No effects available"
	                  description="This channel hasn't set up any paid effects yet. Check back later or try the donation or Q&A features."
	                />
	              </div>
	            ) : !isWalletConnected ? (
	              <div className="card" style={{ marginTop: '12px' }}>
	                <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '12px' }}>
	                  Connect your wallet to trigger effects.
	                </p>
	                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
	                  {actions.slice(0, 3).map((action) => (
	                    <div
	                      key={action.actionKey}
	                      style={{
	                        display: 'flex',
	                        justifyContent: 'space-between',
	                        alignItems: 'center',
	                        padding: '10px 12px',
	                        background: 'var(--panel-2)',
	                        border: '1px solid var(--border)',
	                        borderRadius: '8px',
	                        fontSize: '13px',
	                      }}
	                    >
	                      <span style={{ fontWeight: 600 }}>{action.actionKey}</span>
	                      <span style={{ color: 'var(--muted)' }}>${formatUsdcAmount(action.priceBaseUnits)}</span>
	                    </div>
	                  ))}
	                  {actions.length > 3 && (
	                    <p style={{ marginTop: '4px', color: 'var(--muted)', fontSize: '12px' }}>
	                      +{actions.length - 3} more effect{actions.length - 3 === 1 ? '' : 's'}
	                    </p>
	                  )}
	                </div>
	                <button
	                  onClick={handleConnectWallet}
	                  disabled={isWalletConnecting}
	                  style={{
	                    marginTop: '12px',
	                    background: 'var(--primary)',
	                    color: 'var(--primary-text)',
	                    width: '100%',
	                  }}
	                >
	                  {isWalletConnecting ? 'Connecting...' : 'Connect Wallet'}
	                </button>
	              </div>
	            ) : (
	              <div
	                style={{
	                  display: 'grid',
	                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
	                  gap: '12px',
	                  marginTop: '12px',
	                }}
	              >
	                {actions.map((action) => (
	                  <button
	                    key={action.actionKey}
	                    onClick={() => handleTriggerAction(action.actionKey)}
	                    disabled={!isWalletConnected || paymentState === 'signing' || paymentState === 'settling'}
	                    style={{
	                      padding: '16px',
	                      background:
	                        activeAction === action.actionKey && paymentState !== 'idle' && paymentState !== 'done'
	                          ? '#f59e0b'
	                          : 'var(--panel-2)',
	                      color:
	                        activeAction === action.actionKey && paymentState !== 'idle' && paymentState !== 'done'
	                          ? 'var(--primary-text)'
	                          : 'var(--text)',
	                      border: '1px solid var(--border)',
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
	                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
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
	                        style={{ color: 'var(--accent-text)' }}
	                      >
	                        {lastResult.txHash.slice(0, 10)}...
	                      </a>
	                      <button
	                        onClick={() => handleCopyTxHash(lastResult.txHash)}
	                        style={{ marginLeft: '8px', background: 'transparent', color: 'var(--muted)', border: 'none', cursor: 'pointer', fontSize: '12px' }}
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

	          <section style={{ marginTop: '24px' }}>
		            <h2>Support</h2>
		            <div className="card" style={{ marginTop: '12px' }}>
		              {!isWalletConnected ? (
		                <div>
		                  <p style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '12px' }}>
		                    Connect your wallet to donate or ask a question.
		                  </p>
		                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
		                    <div
		                      style={{
		                        display: 'flex',
		                        justifyContent: 'space-between',
		                        alignItems: 'center',
		                        padding: '10px 12px',
		                        background: 'var(--panel-2)',
		                        border: '1px solid var(--border)',
		                        borderRadius: '8px',
		                        fontSize: '13px',
		                      }}
		                    >
		                      <span style={{ fontWeight: 600 }}>Donate</span>
		                      <span style={{ color: 'var(--muted)' }}>from $0.05</span>
		                    </div>
		                    <div
		                      style={{
		                        display: 'flex',
		                        justifyContent: 'space-between',
		                        alignItems: 'center',
		                        padding: '10px 12px',
		                        background: 'var(--panel-2)',
		                        border: '1px solid var(--border)',
		                        borderRadius: '8px',
		                        fontSize: '13px',
		                      }}
		                    >
		                      <span style={{ fontWeight: 600 }}>Ask a Question</span>
		                      <span style={{ color: 'var(--muted)' }}>from $0.25</span>
		                    </div>
		                  </div>
		                  <button
		                    onClick={handleConnectWallet}
		                    disabled={isWalletConnecting}
		                    style={{
		                      marginTop: '12px',
		                      background: 'var(--primary)',
		                      color: 'var(--primary-text)',
		                      width: '100%',
		                    }}
		                  >
		                    {isWalletConnecting ? 'Connecting...' : 'Connect Wallet'}
		                  </button>
		                </div>
		              ) : (
		                <>
		                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
		                <button
		                  onClick={() => setSupportKind('donation')}
		                  disabled={supportState === 'needs_payment' || supportState === 'signing' || supportState === 'settling'}
		                  style={{
		                    flex: 1,
		                    background: supportKind === 'donation' ? 'var(--primary)' : 'var(--panel-2)',
		                    color: supportKind === 'donation' ? 'var(--primary-text)' : 'var(--text)',
		                    border: '1px solid var(--border)',
		                  }}
		                >
		                  Donate
		                </button>
		                <button
		                  onClick={() => setSupportKind('qa')}
		                  disabled={supportState === 'needs_payment' || supportState === 'signing' || supportState === 'settling'}
		                  style={{
		                    flex: 1,
		                    background: supportKind === 'qa' ? 'var(--primary)' : 'var(--panel-2)',
		                    color: supportKind === 'qa' ? 'var(--primary-text)' : 'var(--text)',
		                    border: '1px solid var(--border)',
		                  }}
		                >
		                  Ask a Question
		                </button>
		              </div>
		              <p style={{ color: 'var(--muted)', fontSize: '14px', lineHeight: 1.4 }}>
		                {supportKind === 'donation'
		                  ? 'Donate while watching the stream. Amounts are in USDC; choose a preset or enter a custom amount.'
		                  : 'Ask a question while watching the stream. Choose a tier; questions appear on the streamer overlay.'}
	              </p>

              {supportKind === 'donation' && (
                <>
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
	                      background: donationAmount === preset.value ? 'var(--primary)' : 'var(--panel-2)',
	                      color: donationAmount === preset.value ? 'var(--primary-text)' : 'var(--text)',
	                      border: '1px solid var(--border)',
	                    }}
	                  >
                    {preset.label}
                  </button>
                ))}
              </div>

	              <div style={{ marginTop: '12px' }}>
	                <label style={{ display: 'block', marginBottom: '4px', color: 'var(--muted)', fontSize: '14px' }}>
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
	                  <p style={{ marginTop: '8px', color: 'var(--danger)', fontSize: '13px' }}>
	                    {donationAmountError}
	                  </p>
	                )}
	              </div>
                </>
              )}

	              <div style={{ marginTop: '12px' }}>
	                <label style={{ display: 'block', marginBottom: '4px', color: 'var(--muted)', fontSize: '14px' }}>
	                  Display Name (optional)
	                </label>
                <input
                  type="text"
                  value={supportDisplayName}
                  onChange={(e) => setSupportDisplayName(e.target.value)}
                  placeholder="Anonymous"
                  style={{ width: '100%' }}
                />
	              </div>

	              {supportKind === 'qa' && (
	                <div style={{ marginTop: '12px' }}>
	                  <label style={{ display: 'block', marginBottom: '4px', color: 'var(--muted)', fontSize: '14px' }}>
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
	              )}

	              <div style={{ marginTop: '12px' }}>
		                <label style={{ display: 'block', marginBottom: '4px', color: 'var(--muted)', fontSize: '14px' }}>
		                  {supportKind === 'donation' ? 'Message (optional)' : 'Your Question'}
		                </label>
	                <textarea
	                  value={supportMessage}
	                  onChange={(e) => setSupportMessage(e.target.value)}
	                  placeholder={supportKind === 'donation' ? 'Say something...' : 'Type your question...'}
	                  rows={supportKind === 'donation' ? 2 : 3}
	                  style={{ width: '100%', resize: 'vertical' }}
	                />
              </div>

	              <button
		                onClick={handleSubmitSupport}
		                disabled={
		                  !isWalletConnected ||
		                  supportState === 'needs_payment' ||
		                  supportState === 'signing' ||
		                  supportState === 'settling' ||
		                  (supportKind === 'qa' && !supportMessage.trim())
		                }
		                style={{ marginTop: '12px', background: 'var(--primary)', color: 'var(--primary-text)', width: '100%' }}
		              >
	                {supportState === 'signing'
	                  ? 'Signing...'
	                  : supportState === 'settling'
	                  ? 'Settling...'
	                  : supportKind === 'donation'
	                  ? `Donate $${donationAmount}`
	                  : 'Submit Question'}
	              </button>

		              {supportState !== 'idle' && (
		                <div className="card" style={{ marginTop: '12px' }}>
		                  <p>
	                    {supportState === 'needs_payment' && 'Requesting payment...'}
	                    {supportState === 'signing' && 'Please sign the transaction...'}
	                    {supportState === 'settling' && 'Settling payment...'}
	                    {supportState === 'done' && supportResult && (
	                      <>
	                        {supportKind === 'donation' ? 'Thanks!' : 'Question submitted!'} TX:{' '}
		                        <a
		                          href={`https://explorer.cronos.org/testnet/tx/${supportResult.txHash}`}
		                          target="_blank"
		                          rel="noopener noreferrer"
		                          style={{ color: 'var(--accent-text)' }}
		                        >
		                          {supportResult.txHash.slice(0, 10)}...
		                        </a>
	                      </>
	                    )}
	                    {supportState === 'error' && 'Error occurred'}
	                  </p>
		                </div>
		              )}
		                </>
		              )}
		            </div>
	          </section>

        </aside>
      </div>
      </div>
    </div>
  );
}
