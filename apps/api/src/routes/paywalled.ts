import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { queryOne, execute } from '../db/db.js';
import { logger } from '../logger.js';
import { getChannelBySlug, getActionForChannel } from './public.js';
import { buildPaymentRequirements, build402Response } from '../x402/paymentRequirements.js';
import { verifyPayment, settlePayment, isSettleSuccess } from '../x402/facilitator.js';
import { PRICING } from '../x402/constants.js';
import {
  checkIdempotency,
  parsePaymentHeader,
  createVerifiedPayment,
  markPaymentSettled,
  markPaymentFailed,
} from '../x402/idempotency.js';
import { broadcastToOverlay, broadcastToDashboard, broadcastToAll } from '../sse/broker.js';
import type { SettleSuccessResponse } from '../x402/types.js';

// Simple content policy filter
const BANNED_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // email
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // phone numbers
  /\b(?:fuck|shit|ass|bitch|nigger|faggot)\b/i, // banned words
];

function checkContentPolicy(message: string): { ok: boolean; reason?: string } {
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(message)) {
      return { ok: false, reason: 'Message violates content policy' };
    }
  }
  return { ok: true };
}

function isWalletBlocked(channelId: string, fromAddress: string): boolean {
  const blocked = queryOne<{ id: string }>(
    'SELECT id FROM blocks WHERE channelId = ? AND fromAddress = ?',
    [channelId, fromAddress.toLowerCase()]
  );
  return !!blocked;
}

const router = Router();

function getPaymentHeader(req: Request): string | undefined {
  // Case-insensitive header access
  return req.get('X-PAYMENT') || (req.headers['x-payment'] as string | undefined);
}

// POST /api/channels/:slug/trigger
router.post('/channels/:slug/trigger', async (req: Request, res: Response) => {
  const { slug } = req.params;
  const { actionKey } = req.body;

  if (!actionKey) {
    res.status(400).json({ error: 'Missing actionKey' });
    return;
  }

  // Get channel
  const channel = getChannelBySlug(slug);
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }

  // Get action
  const action = getActionForChannel(channel.id, actionKey);
  if (!action) {
    res.status(404).json({ error: 'Action not found' });
    return;
  }

  // Check for payment header
  const paymentHeaderBase64 = getPaymentHeader(req);

  if (!paymentHeaderBase64) {
    // Return 402 with payment requirements
    const requirements = buildPaymentRequirements({
      network: channel.network,
      payTo: channel.payToAddress,
      amount: action.priceBaseUnits,
      description: `Trigger effect: ${actionKey}`,
    });

    res.status(402).json(build402Response(requirements));
    return;
  }

  // Check idempotency
  const { paymentId, existing } = checkIdempotency(paymentHeaderBase64, channel.id);

  if (existing && existing.status === 'settled') {
    logger.info('Returning cached settlement for duplicate request', { paymentId });
    res.json({
      ok: true,
      cached: true,
      payment: {
        paymentId,
        txHash: existing.txHash,
        from: existing.fromAddress,
        to: existing.toAddress,
        value: existing.value,
      },
    });
    return;
  }

  // Parse payment header
  let paymentHeader;
  try {
    paymentHeader = parsePaymentHeader(paymentHeaderBase64);
  } catch (err) {
    res.status(400).json({ error: 'Invalid payment header format' });
    return;
  }

  // Build payment requirements for verification
  const requirements = buildPaymentRequirements({
    network: channel.network,
    payTo: channel.payToAddress,
    amount: action.priceBaseUnits,
    description: `Trigger effect: ${actionKey}`,
  });

  // Verify payment
  const verifyResult = await verifyPayment({
    paymentHeaderBase64,
    paymentRequirements: requirements,
  });

  if (!verifyResult.isValid) {
    logger.warn('Payment verification failed', { paymentId, reason: verifyResult.invalidReason });
    res.status(400).json({ error: 'Payment verification failed', reason: verifyResult.invalidReason });
    return;
  }

  // Create payment record (if new)
  if (!existing) {
    createVerifiedPayment({
      channelId: channel.id,
      paymentId,
      paymentHeader,
    });
  }

  // Settle payment
  const settleResult = await settlePayment({
    paymentHeaderBase64,
    paymentRequirements: requirements,
  });

  if (!isSettleSuccess(settleResult)) {
    markPaymentFailed(paymentId, settleResult.error);
    res.status(400).json({ error: 'Settlement failed', reason: settleResult.error });
    return;
  }

  // Mark as settled
  markPaymentSettled(paymentId, settleResult);

  // Emit SSE event
  const eventId = uuid();
  const payload = JSON.parse(action.payloadJson);

  broadcastToOverlay(slug, 'effect.triggered', {
    eventId,
    actionKey,
    type: action.type,
    payload,
    amount: action.priceBaseUnits,
    from: settleResult.from,
    txHash: settleResult.txHash,
    timestamp: Date.now(),
  });

  logger.info('Effect triggered', { eventId, actionKey, txHash: settleResult.txHash });

  res.json({
    ok: true,
    payment: {
      paymentId,
      txHash: settleResult.txHash,
      from: settleResult.from,
      to: settleResult.to,
      value: settleResult.value,
      blockNumber: settleResult.blockNumber,
    },
  });
});

// POST /api/channels/:slug/qa - Submit Q&A question
router.post('/channels/:slug/qa', async (req: Request, res: Response) => {
  const { slug } = req.params;
  const { message, displayName, tier = 'normal' } = req.body;

  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'Missing or invalid message' });
    return;
  }

  if (tier !== 'normal' && tier !== 'priority') {
    res.status(400).json({ error: 'Invalid tier. Must be "normal" or "priority"' });
    return;
  }

  // Check content policy BEFORE payment
  const policyCheck = checkContentPolicy(message);
  if (!policyCheck.ok) {
    res.status(400).json({ error: policyCheck.reason });
    return;
  }

  // Get channel
  const channel = getChannelBySlug(slug);
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }

  // Get price for tier
  const amount = tier === 'priority' ? PRICING.qaPriority : PRICING.qaNormal;

  // Check for payment header
  const paymentHeaderBase64 = getPaymentHeader(req);

  if (!paymentHeaderBase64) {
    const requirements = buildPaymentRequirements({
      network: channel.network,
      payTo: channel.payToAddress,
      amount,
      description: `Paid Q&A: ${tier}`,
    });

    res.status(402).json(build402Response(requirements));
    return;
  }

  // Check idempotency
  const { paymentId, existing } = checkIdempotency(paymentHeaderBase64, channel.id);

  if (existing && existing.status === 'settled') {
    // Check if Q&A already exists
    const existingQa = queryOne<{ id: string }>(
      'SELECT id FROM qa_items WHERE paymentId = ?',
      [paymentId]
    );

    if (existingQa) {
      logger.info('Returning cached Q&A for duplicate request', { paymentId, qaId: existingQa.id });
      res.json({
        ok: true,
        cached: true,
        qaId: existingQa.id,
        payment: {
          paymentId,
          txHash: existing.txHash,
          from: existing.fromAddress,
          to: existing.toAddress,
          value: existing.value,
        },
      });
      return;
    }
  }

  // Parse payment header
  let paymentHeader;
  try {
    paymentHeader = parsePaymentHeader(paymentHeaderBase64);
  } catch (err) {
    res.status(400).json({ error: 'Invalid payment header format' });
    return;
  }

  // Build payment requirements for verification
  const requirements = buildPaymentRequirements({
    network: channel.network,
    payTo: channel.payToAddress,
    amount,
    description: `Paid Q&A: ${tier}`,
  });

  // Verify payment
  const verifyResult = await verifyPayment({
    paymentHeaderBase64,
    paymentRequirements: requirements,
  });

  if (!verifyResult.isValid) {
    logger.warn('Payment verification failed', { paymentId, reason: verifyResult.invalidReason });
    res.status(400).json({ error: 'Payment verification failed', reason: verifyResult.invalidReason });
    return;
  }

  // Check if wallet is blocked AFTER verify (so we have the from address)
  const fromAddress = paymentHeader.payload.from;
  if (isWalletBlocked(channel.id, fromAddress)) {
    logger.warn('Blocked wallet attempted Q&A', { paymentId, fromAddress });
    res.status(403).json({ error: 'Your wallet has been blocked from this channel' });
    return;
  }

  // Create payment record (if new)
  if (!existing) {
    createVerifiedPayment({
      channelId: channel.id,
      paymentId,
      paymentHeader,
    });
  }

  // Settle payment
  const settleResult = await settlePayment({
    paymentHeaderBase64,
    paymentRequirements: requirements,
  });

  if (!isSettleSuccess(settleResult)) {
    markPaymentFailed(paymentId, settleResult.error);
    res.status(400).json({ error: 'Settlement failed', reason: settleResult.error });
    return;
  }

  // Mark as settled
  markPaymentSettled(paymentId, settleResult);

  // Insert Q&A item
  const qaId = uuid();
  execute(
    `INSERT INTO qa_items (id, channelId, paymentId, fromAddress, displayName, message, tier, priceBaseUnits, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
    [qaId, channel.id, paymentId, fromAddress.toLowerCase(), displayName || null, message, tier, amount]
  );

  // Emit SSE event
  broadcastToAll(slug, 'qa.created', {
    qaId,
    tier,
    message,
    displayName: displayName || null,
    amount,
    from: settleResult.from,
    txHash: settleResult.txHash,
    createdAt: Date.now(),
  });

  logger.info('Q&A created', { qaId, tier, txHash: settleResult.txHash });

  res.json({
    ok: true,
    qaId,
    payment: {
      paymentId,
      txHash: settleResult.txHash,
      from: settleResult.from,
      to: settleResult.to,
      value: settleResult.value,
      blockNumber: settleResult.blockNumber,
    },
  });
});

export default router;
