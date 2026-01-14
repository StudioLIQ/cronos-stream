import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchChannel, fetchActions, triggerAction, submitQA, is402Response } from '../lib/api';
import type { Channel, Action, PaymentResponse } from '../lib/api';
import { connectWallet, getSigner, isConnected, switchToCronosTestnet } from '../lib/wallet';
import { createPaymentHeader, formatUsdcAmount } from '../lib/x402';

type PaymentState = 'idle' | 'needs_payment' | 'signing' | 'settling' | 'done' | 'error';

interface PaymentResult {
  txHash: string;
  from: string;
  value: string;
}

export default function Viewer() {
  const { slug } = useParams<{ slug: string }>();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return <div className="container"><p>Loading...</p></div>;
  }

  if (!channel) {
    return <div className="container"><p>Channel not found</p></div>;
  }

  return (
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

      <section style={{ marginBottom: '32px' }}>
        <h2>Effects</h2>
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

      <section>
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
    </div>
  );
}
