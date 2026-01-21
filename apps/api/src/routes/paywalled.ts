import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { queryOne, execute } from '../db/db.js';
import { logger } from '../logger.js';
import { getChannelBySlug, getActionForChannel } from './public.js';
import { buildPaymentRequirements, build402Response, validateAmount } from '../x402/paymentRequirements.js';
import { verifyPayment, settlePayment, isSettleSuccess } from '../x402/facilitator.js';
import { PRICING } from '../x402/constants.js';
import {
  checkIdempotency,
  parsePaymentHeader,
  createVerifiedPayment,
  markPaymentSettled,
  markPaymentFailed,
  updatePaymentContext,
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

async function isWalletBlocked(channelId: string, fromAddress: string): Promise<boolean> {
  const blocked = await queryOne<{ id: string }>(
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
router.post('/channels/:slug/trigger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const { actionKey } = req.body;

    if (!actionKey) {
      res.status(400).json({ error: 'Missing actionKey' });
      return;
    }

    // Get channel
    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Get action
    const action = await getActionForChannel(channel.id, actionKey);
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
    const { paymentId, existing } = await checkIdempotency(paymentHeaderBase64, channel.id);

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
    } catch {
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
      await createVerifiedPayment({
        channelId: channel.id,
        paymentId,
        paymentHeader,
        context: { kind: 'effect', actionKey },
      });
    } else if (!existing.kind) {
      // Backfill context for existing payment
      await updatePaymentContext(paymentId, { kind: 'effect', actionKey });
    }

    // Settle payment
    const settleResult = await settlePayment({
      paymentHeaderBase64,
      paymentRequirements: requirements,
    });

    if (!isSettleSuccess(settleResult)) {
      await markPaymentFailed(paymentId, settleResult.error);
      res.status(400).json({ error: 'Settlement failed', reason: settleResult.error });
      return;
    }

    // Mark as settled
    await markPaymentSettled(paymentId, settleResult);

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
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/:slug/qa - Submit Q&A question
router.post('/channels/:slug/qa', async (req: Request, res: Response, next: NextFunction) => {
  try {
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
    const channel = await getChannelBySlug(slug);
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
    const { paymentId, existing } = await checkIdempotency(paymentHeaderBase64, channel.id);

    if (existing && existing.status === 'settled') {
      // Check if Q&A already exists
      const existingQa = await queryOne<{ id: string }>(
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
    } catch {
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
    if (await isWalletBlocked(channel.id, fromAddress)) {
      logger.warn('Blocked wallet attempted Q&A', { paymentId, fromAddress });
      res.status(403).json({ error: 'Your wallet has been blocked from this channel' });
      return;
    }

    // Generate Q&A ID early so we can store it in payment context
    const qaId = uuid();

    // Create payment record (if new)
    if (!existing) {
      await createVerifiedPayment({
        channelId: channel.id,
        paymentId,
        paymentHeader,
        context: { kind: 'qa', qaId },
      });
    } else if (!existing.kind) {
      // Backfill context for existing payment
      await updatePaymentContext(paymentId, { kind: 'qa', qaId });
    }

    // Settle payment
    const settleResult = await settlePayment({
      paymentHeaderBase64,
      paymentRequirements: requirements,
    });

    if (!isSettleSuccess(settleResult)) {
      await markPaymentFailed(paymentId, settleResult.error);
      res.status(400).json({ error: 'Settlement failed', reason: settleResult.error });
      return;
    }

    // Mark as settled
    await markPaymentSettled(paymentId, settleResult);

    // Insert Q&A item
    await execute(
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
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/:slug/donate - Send a donation with a user-chosen amount
router.post('/channels/:slug/donate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const { amountBaseUnits, message, displayName } = req.body;

    if (!amountBaseUnits || typeof amountBaseUnits !== 'string') {
      res.status(400).json({ error: 'Missing or invalid amountBaseUnits' });
      return;
    }

    try {
      validateAmount(amountBaseUnits);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    if (BigInt(amountBaseUnits) <= 0n) {
      res.status(400).json({ error: 'amountBaseUnits must be greater than 0' });
      return;
    }

    if (message !== undefined && message !== null && typeof message !== 'string') {
      res.status(400).json({ error: 'Invalid message' });
      return;
    }

    if (displayName !== undefined && displayName !== null && typeof displayName !== 'string') {
      res.status(400).json({ error: 'Invalid displayName' });
      return;
    }

    // Check content policy BEFORE payment
    if (typeof message === 'string' && message.trim()) {
      const policyCheck = checkContentPolicy(message);
      if (!policyCheck.ok) {
        res.status(400).json({ error: policyCheck.reason });
        return;
      }
    }

    // Get channel
    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Check for payment header
    const paymentHeaderBase64 = getPaymentHeader(req);

    if (!paymentHeaderBase64) {
      const requirements = buildPaymentRequirements({
        network: channel.network,
        payTo: channel.payToAddress,
        amount: amountBaseUnits,
        description: 'Donation',
      });

      res.status(402).json(build402Response(requirements));
      return;
    }

    // Check idempotency
    const { paymentId, existing } = await checkIdempotency(paymentHeaderBase64, channel.id);

    if (existing && existing.status === 'settled') {
      logger.info('Returning cached settlement for duplicate donation request', { paymentId });
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
    } catch {
      res.status(400).json({ error: 'Invalid payment header format' });
      return;
    }

    // Build payment requirements for verification
    const requirements = buildPaymentRequirements({
      network: channel.network,
      payTo: channel.payToAddress,
      amount: amountBaseUnits,
      description: 'Donation',
    });

    // Verify payment
    const verifyResult = await verifyPayment({
      paymentHeaderBase64,
      paymentRequirements: requirements,
    });

    if (!verifyResult.isValid) {
      logger.warn('Donation payment verification failed', { paymentId, reason: verifyResult.invalidReason });
      res.status(400).json({ error: 'Payment verification failed', reason: verifyResult.invalidReason });
      return;
    }

    // Create payment record (if new)
    if (!existing) {
      await createVerifiedPayment({
        channelId: channel.id,
        paymentId,
        paymentHeader,
        context: { kind: 'donation' },
      });
    } else if (!existing.kind) {
      // Backfill context for existing payment
      await updatePaymentContext(paymentId, { kind: 'donation' });
    }

    // Settle payment
    const settleResult = await settlePayment({
      paymentHeaderBase64,
      paymentRequirements: requirements,
    });

    if (!isSettleSuccess(settleResult)) {
      await markPaymentFailed(paymentId, settleResult.error);
      res.status(400).json({ error: 'Settlement failed', reason: settleResult.error });
      return;
    }

    // Mark as settled
    await markPaymentSettled(paymentId, settleResult);

    // Emit SSE event
    const donationId = uuid();
    broadcastToOverlay(slug, 'donation.received', {
      donationId,
      amount: settleResult.value,
      message: typeof message === 'string' && message.trim() ? message.trim() : null,
      displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null,
      from: settleResult.from,
      txHash: settleResult.txHash,
      timestamp: Date.now(),
    });

    logger.info('Donation received', { donationId, paymentId, txHash: settleResult.txHash });

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
  } catch (err) {
    next(err);
  }
});

interface MembershipPlanRow {
  id: string;
  channelId: string;
  name: string;
  priceBaseUnits: string;
  durationDays: number;
  enabled: number;
}

interface MembershipRow {
  id: string;
  channelId: string;
  fromAddress: string;
  planId: string;
  expiresAt: string;
  lastPaymentId: string | null;
  revoked: number;
}

// POST /api/channels/:slug/memberships - Subscribe to membership (paywalled)
router.post('/channels/:slug/memberships', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const { planId } = req.body;

    if (!planId || typeof planId !== 'string') {
      res.status(400).json({ error: 'Missing or invalid planId' });
      return;
    }

    // Get channel
    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Get membership plan
    const plan = await queryOne<MembershipPlanRow>(
      'SELECT * FROM membership_plans WHERE id = ? AND channelId = ? AND enabled = 1',
      [planId, channel.id]
    );

    if (!plan) {
      res.status(404).json({ error: 'Membership plan not found' });
      return;
    }

    // Check for payment header
    const paymentHeaderBase64 = getPaymentHeader(req);

    if (!paymentHeaderBase64) {
      const requirements = buildPaymentRequirements({
        network: channel.network,
        payTo: channel.payToAddress,
        amount: plan.priceBaseUnits,
        description: `Membership: ${plan.name}`,
      });

      res.status(402).json(build402Response(requirements));
      return;
    }

    // Check idempotency
    const { paymentId, existing } = await checkIdempotency(paymentHeaderBase64, channel.id);

    if (existing && existing.status === 'settled') {
      // Check if membership already exists for this payment
      const existingMembership = await queryOne<MembershipRow>(
        'SELECT * FROM memberships WHERE channelId = ? AND lastPaymentId = ?',
        [channel.id, paymentId]
      );

      if (existingMembership) {
        logger.info('Returning cached membership for duplicate request', { paymentId });
        res.json({
          ok: true,
          cached: true,
          membership: {
            planId: existingMembership.planId,
            expiresAt: existingMembership.expiresAt,
          },
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
    } catch {
      res.status(400).json({ error: 'Invalid payment header format' });
      return;
    }

    // Build payment requirements for verification
    const requirements = buildPaymentRequirements({
      network: channel.network,
      payTo: channel.payToAddress,
      amount: plan.priceBaseUnits,
      description: `Membership: ${plan.name}`,
    });

    // Verify payment
    const verifyResult = await verifyPayment({
      paymentHeaderBase64,
      paymentRequirements: requirements,
    });

    if (!verifyResult.isValid) {
      logger.warn('Membership payment verification failed', { paymentId, reason: verifyResult.invalidReason });
      res.status(400).json({ error: 'Payment verification failed', reason: verifyResult.invalidReason });
      return;
    }

    const fromAddress = paymentHeader.payload.from.toLowerCase();

    // Create payment record (if new)
    if (!existing) {
      await createVerifiedPayment({
        channelId: channel.id,
        paymentId,
        paymentHeader,
        context: { kind: 'membership', membershipPlanId: planId },
      });
    } else if (!existing.kind) {
      await updatePaymentContext(paymentId, { kind: 'membership', membershipPlanId: planId });
    }

    // Settle payment
    const settleResult = await settlePayment({
      paymentHeaderBase64,
      paymentRequirements: requirements,
    });

    if (!isSettleSuccess(settleResult)) {
      await markPaymentFailed(paymentId, settleResult.error);
      res.status(400).json({ error: 'Settlement failed', reason: settleResult.error });
      return;
    }

    // Mark as settled
    await markPaymentSettled(paymentId, settleResult);

    // Upsert membership - extend expiresAt if already exists
    const existingMembership = await queryOne<MembershipRow>(
      'SELECT * FROM memberships WHERE channelId = ? AND fromAddress = ?',
      [channel.id, fromAddress]
    );

    let expiresAt: Date;
    const now = new Date();
    const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;

    if (existingMembership && !existingMembership.revoked) {
      // Extend from current expiresAt if still active
      const currentExpires = new Date(existingMembership.expiresAt);
      const baseDate = currentExpires > now ? currentExpires : now;
      expiresAt = new Date(baseDate.getTime() + durationMs);

      await execute(
        `UPDATE memberships SET planId = ?, expiresAt = ?, lastPaymentId = ?, revoked = 0, updatedAt = NOW()
         WHERE id = ?`,
        [planId, expiresAt.toISOString().slice(0, 19).replace('T', ' '), paymentId, existingMembership.id]
      );
    } else if (existingMembership) {
      // Was revoked, reactivate
      expiresAt = new Date(now.getTime() + durationMs);
      await execute(
        `UPDATE memberships SET planId = ?, expiresAt = ?, lastPaymentId = ?, revoked = 0, updatedAt = NOW()
         WHERE id = ?`,
        [planId, expiresAt.toISOString().slice(0, 19).replace('T', ' '), paymentId, existingMembership.id]
      );
    } else {
      // Create new membership
      expiresAt = new Date(now.getTime() + durationMs);
      const membershipId = uuid();
      await execute(
        `INSERT INTO memberships (id, channelId, fromAddress, planId, expiresAt, lastPaymentId)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [membershipId, channel.id, fromAddress, planId, expiresAt.toISOString().slice(0, 19).replace('T', ' '), paymentId]
      );
    }

    logger.info('Membership created/renewed', { paymentId, fromAddress, planId, expiresAt: expiresAt.toISOString() });

    res.json({
      ok: true,
      membership: {
        planId,
        expiresAt: expiresAt.toISOString(),
      },
      payment: {
        paymentId,
        txHash: settleResult.txHash,
        from: settleResult.from,
        to: settleResult.to,
        value: settleResult.value,
        blockNumber: settleResult.blockNumber,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
