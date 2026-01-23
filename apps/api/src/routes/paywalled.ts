import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { queryOne, queryAll, execute } from '../db/db.js';
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
  markPaymentNftMinted,
  markPaymentNftFailed,
  updatePaymentContext,
} from '../x402/idempotency.js';
import { broadcastToOverlay, broadcastToDashboard, broadcastToAll } from '../sse/broker.js';
import type { SettleSuccessResponse } from '../x402/types.js';
import { getEffectiveDisplayName } from './profile.js';
import { getMembershipNftContractAddress, getMembershipTokenId, isMembershipNftConfigured, mintMembershipNft } from '../lib/membershipNft.js';

interface SupportAlertData {
  kind: 'effect' | 'qa' | 'donation' | 'membership';
  paymentId: string;
  value: string;
  fromAddress: string;
  displayName?: string | null;
  txHash: string;
  timestamp: number;
  actionKey?: string;
  qaId?: string;
  membershipPlanId?: string;
}

function emitSupportAlert(slug: string, data: SupportAlertData): void {
  // Broadcast to all streams (overlay + dashboard) so dashboard can update in real-time
  broadcastToAll(slug, 'support.alert', data);
}

// Simple content policy filter
const BANNED_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // email
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // phone numbers
  /\b(?:fuck|shit|ass|bitch|nigger|faggot)\b/i, // banned words
];

interface ActiveMembership {
  planId: string;
  planName: string;
}

async function getActiveMembership(params: {
  channelId: string;
  network: string;
  address: string;
}): Promise<ActiveMembership | null> {
  const { channelId, network, address } = params;

  const membershipNftContract = getMembershipNftContractAddress(network);

  if (membershipNftContract) {
    const membership = await queryOne<{
      planId: string;
      planName: string;
    }>(
      `SELECT m.planId, p.name as planName
       FROM memberships m
       JOIN membership_plans p ON m.planId = p.id
       WHERE m.channelId = ? AND m.fromAddress = ? AND m.revoked = 0
         AND EXISTS (
           SELECT 1 FROM payments pay
           WHERE pay.channelId = m.channelId
             AND pay.fromAddress = m.fromAddress
             AND pay.kind = 'membership'
             AND pay.status = 'settled'
             AND pay.nftTxHash IS NOT NULL
         )`,
      [channelId, address.toLowerCase()]
    );

    if (!membership) return null;
    return membership;
  }

  // Legacy (non-NFT) membership: DB-backed membership (no expiry).
  const membership = await queryOne<{
    planId: string;
    planName: string;
    expiresAt: string;
    revoked: number;
  }>(
    `SELECT m.planId, p.name as planName, m.expiresAt, m.revoked
     FROM memberships m
     JOIN membership_plans p ON m.planId = p.id
     WHERE m.channelId = ? AND m.fromAddress = ?`,
    [channelId, address.toLowerCase()]
  );

  if (!membership) return null;
  if (membership.revoked) return null;

  return {
    planId: membership.planId,
    planName: membership.planName,
  };
}

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

async function blockWallet(channelId: string, fromAddress: string, reason: string): Promise<void> {
  const id = uuid();
  try {
    await execute(
      'INSERT INTO blocks (id, channelId, fromAddress, reason) VALUES (?, ?, ?, ?)',
      [id, channelId, fromAddress.toLowerCase(), reason]
    );
  } catch {
    // Might already be blocked (unique constraint), ignore
  }
}

interface GoalRow {
  id: string;
  channelId: string;
  type: 'donation' | 'membership';
  name: string;
  targetValue: string;
  currentValue: string;
  startsAt: string | null;
  endsAt: string | null;
  enabled: number;
}

// Update donation goal progress (add value to currentValue)
async function updateDonationGoalProgress(slug: string, channelId: string, value: string): Promise<void> {
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Get active donation goals
    const goals = await queryAll<GoalRow>(
      `SELECT * FROM goals
       WHERE channelId = ? AND type = 'donation' AND enabled = 1
         AND (startsAt IS NULL OR startsAt <= ?)
         AND (endsAt IS NULL OR endsAt >= ?)`,
      [channelId, now, now]
    );

    for (const goal of goals) {
      // Add value to currentValue
      const newValue = (BigInt(goal.currentValue) + BigInt(value)).toString();

      await execute(
        'UPDATE goals SET currentValue = ?, updatedAt = NOW() WHERE id = ?',
        [newValue, goal.id]
      );

      // Broadcast goal update to overlay
      const progress = calculateGoalProgress(newValue, goal.targetValue);
      broadcastToOverlay(slug, 'goal.updated', {
        id: goal.id,
        type: goal.type,
        name: goal.name,
        targetValue: goal.targetValue,
        currentValue: newValue,
        progress,
        enabled: true,
      });

      logger.info('Donation goal progress updated', {
        goalId: goal.id,
        previousValue: goal.currentValue,
        addedValue: value,
        newValue,
        progress,
      });
    }
  } catch (err) {
    logger.error('Failed to update donation goal progress', { error: err });
  }
}

// Update membership goal progress (count active members)
async function updateMembershipGoalProgress(slug: string, channelId: string, network: string): Promise<void> {
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const membershipNftContract = getMembershipNftContractAddress(network);

    // Get active membership goals
    const goals = await queryAll<GoalRow>(
      `SELECT * FROM goals
       WHERE channelId = ? AND type = 'membership' AND enabled = 1
         AND (startsAt IS NULL OR startsAt <= ?)
         AND (endsAt IS NULL OR endsAt >= ?)`,
      [channelId, now, now]
    );

    if (goals.length === 0) return;

    // Count active members
    const countResult = membershipNftContract
      ? await queryOne<{ count: number }>(
          `SELECT COUNT(*) as count
           FROM memberships m
           WHERE m.channelId = ? AND m.revoked = 0
             AND EXISTS (
               SELECT 1 FROM payments pay
               WHERE pay.channelId = m.channelId
                 AND pay.fromAddress = m.fromAddress
                 AND pay.kind = 'membership'
                 AND pay.status = 'settled'
                 AND pay.nftTxHash IS NOT NULL
             )`,
          [channelId]
        )
      : await queryOne<{ count: number }>(
          `SELECT COUNT(*) as count FROM memberships
           WHERE channelId = ? AND revoked = 0`,
          [channelId]
        );
    const activeMemberCount = countResult?.count?.toString() || '0';

    for (const goal of goals) {
      // Update currentValue to active member count
      await execute(
        'UPDATE goals SET currentValue = ?, updatedAt = NOW() WHERE id = ?',
        [activeMemberCount, goal.id]
      );

      // Broadcast goal update to overlay
      const progress = calculateGoalProgress(activeMemberCount, goal.targetValue);
      broadcastToOverlay(slug, 'goal.updated', {
        id: goal.id,
        type: goal.type,
        name: goal.name,
        targetValue: goal.targetValue,
        currentValue: activeMemberCount,
        progress,
        enabled: true,
      });

      logger.info('Membership goal progress updated', {
        goalId: goal.id,
        activeMemberCount,
        progress,
      });
    }
  } catch (err) {
    logger.error('Failed to update membership goal progress', { error: err });
  }
}

function calculateGoalProgress(current: string, target: string): number {
  try {
    const currentNum = BigInt(current);
    const targetNum = BigInt(target);
    if (targetNum === 0n) return 0;
    const progressBig = (currentNum * 100n) / targetNum;
    return Math.min(Number(progressBig), 100);
  } catch {
    return 0;
  }
}

function normalizeBlockNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    try {
      const big = BigInt(trimmed);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
      return Number(big);
    } catch {
      return undefined;
    }
  }
  return undefined;
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

    // Enforce channel blocks AFTER verify (so fromAddress is authenticated)
    const fromAddress = paymentHeader.payload.from;
    if (await isWalletBlocked(channel.id, fromAddress)) {
      logger.warn('Blocked wallet attempted effect trigger', { paymentId, fromAddress, actionKey });
      res.status(403).json({ error: 'Your wallet has been blocked from this channel' });
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

    // Emit SSE events
    const eventId = uuid();
    const payload = JSON.parse(action.payloadJson);
    const timestamp = Date.now();

    broadcastToOverlay(slug, 'effect.triggered', {
      eventId,
      actionKey,
      type: action.type,
      payload,
      amount: action.priceBaseUnits,
      from: settleResult.from,
      txHash: settleResult.txHash,
      timestamp,
    });

    // Emit unified support.alert
    emitSupportAlert(slug, {
      kind: 'effect',
      paymentId,
      value: settleResult.value,
      fromAddress: settleResult.from,
      txHash: settleResult.txHash,
      timestamp,
      actionKey,
    });

    // Update donation goal progress
    await updateDonationGoalProgress(slug, channel.id, settleResult.value);

    logger.info('Effect triggered', { eventId, actionKey, txHash: settleResult.txHash });

    res.json({
      ok: true,
      payment: {
      paymentId,
      txHash: settleResult.txHash,
      from: settleResult.from,
      to: settleResult.to,
      value: settleResult.value,
      blockNumber: normalizeBlockNumber(settleResult.blockNumber),
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

    // Resolve effective display name from wallet profile (snapshot at time of submit)
    const effectiveDisplayName = await getEffectiveDisplayName(channel.id, fromAddress) || displayName || null;

    // Check membership status at time of submit
    const activeMembership = await getActiveMembership({ channelId: channel.id, network: channel.network, address: fromAddress });
    const isMember = activeMembership !== null;
    const memberPlanId = activeMembership?.planId || null;

    // Insert Q&A item
    await execute(
      `INSERT INTO qa_items (id, channelId, paymentId, fromAddress, displayName, message, tier, priceBaseUnits, status, isMember, memberPlanId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
      [qaId, channel.id, paymentId, fromAddress.toLowerCase(), effectiveDisplayName, message, tier, amount, isMember ? 1 : 0, memberPlanId]
    );

    // Emit SSE events
    const timestamp = Date.now();

    broadcastToAll(slug, 'qa.created', {
      qaId,
      tier,
      message,
      displayName: effectiveDisplayName,
      amount,
      from: settleResult.from,
      txHash: settleResult.txHash,
      createdAt: timestamp,
      isMember,
      memberPlanId,
    });

    // Emit unified support.alert
    emitSupportAlert(slug, {
      kind: 'qa',
      paymentId,
      value: settleResult.value,
      fromAddress: settleResult.from,
      displayName: effectiveDisplayName,
      txHash: settleResult.txHash,
      timestamp,
      qaId,
    });

    // Update donation goal progress
    await updateDonationGoalProgress(slug, channel.id, settleResult.value);

    logger.info('Q&A created', { qaId, tier, txHash: settleResult.txHash, displayName: effectiveDisplayName, isMember });

    res.json({
      ok: true,
      qaId,
      payment: {
      paymentId,
      txHash: settleResult.txHash,
      from: settleResult.from,
      to: settleResult.to,
      value: settleResult.value,
      blockNumber: normalizeBlockNumber(settleResult.blockNumber),
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

    // Blocklist gate (AFTER verify, BEFORE settle)
    const fromAddress = paymentHeader.payload.from;
    if (await isWalletBlocked(channel.id, fromAddress)) {
      logger.warn('Blocked wallet attempted donation', { paymentId, fromAddress });
      res.status(403).json({ error: 'Your wallet has been blocked from this channel' });
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

    // Emit SSE events
    const donationId = uuid();
    const timestamp = Date.now();
    const donationDisplayName = typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null;

    broadcastToOverlay(slug, 'donation.received', {
      donationId,
      amount: settleResult.value,
      message: typeof message === 'string' && message.trim() ? message.trim() : null,
      displayName: donationDisplayName,
      from: settleResult.from,
      txHash: settleResult.txHash,
      timestamp,
    });

    // Emit unified support.alert
    emitSupportAlert(slug, {
      kind: 'donation',
      paymentId,
      value: settleResult.value,
      fromAddress: settleResult.from,
      displayName: donationDisplayName,
      txHash: settleResult.txHash,
      timestamp,
    });

    // Update donation goal progress
    await updateDonationGoalProgress(slug, channel.id, settleResult.value);

    logger.info('Donation received', { donationId, paymentId, txHash: settleResult.txHash });

    res.json({
      ok: true,
      payment: {
      paymentId,
      txHash: settleResult.txHash,
      from: settleResult.from,
      to: settleResult.to,
      value: settleResult.value,
      blockNumber: normalizeBlockNumber(settleResult.blockNumber),
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

    const membershipNftContract = getMembershipNftContractAddress(channel.network);
    const useMembershipNft = Boolean(membershipNftContract);

    if (useMembershipNft && !isMembershipNftConfigured(channel.network)) {
      res.status(500).json({
        error: 'Membership NFT is not configured',
        reason: 'Set MEMBERSHIP_NFT_ADDRESS_* and MEMBERSHIP_NFT_MINTER_PRIVATE_KEY on the API',
      });
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

    if (existing) {
      if (existing.channelId !== channel.id) {
        res.status(409).json({ error: 'Payment header already used for another channel' });
        return;
      }
      if (existing.kind && existing.kind !== 'membership') {
        res.status(409).json({ error: `Payment header already used for: ${existing.kind}` });
        return;
      }
      if (existing.membershipPlanId && existing.membershipPlanId !== planId) {
        res.status(409).json({ error: 'Payment header already used for a different membership plan' });
        return;
      }
    }

    const foreverExpiresAt = '9999-12-31 23:59:59';

    const upsertMembership = async (
      fromAddress: string,
      opts: { reactivate: boolean }
    ): Promise<void> => {
      const existingMembership = await queryOne<MembershipRow>(
        'SELECT * FROM memberships WHERE channelId = ? AND fromAddress = ?',
        [channel.id, fromAddress]
      );

      if (existingMembership) {
        if (!opts.reactivate) return;
        await execute(
          `UPDATE memberships SET planId = ?, expiresAt = ?, lastPaymentId = ?, revoked = 0, updatedAt = NOW()
           WHERE id = ?`,
          [planId, foreverExpiresAt, paymentId, existingMembership.id]
        );
        return;
      }

      const membershipId = uuid();
      await execute(
        `INSERT INTO memberships (id, channelId, fromAddress, planId, expiresAt, lastPaymentId)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [membershipId, channel.id, fromAddress, planId, foreverExpiresAt, paymentId]
      );
    };

    const buildSuccessResponse = (params: {
      payment: {
        paymentId: string;
        txHash: string;
        from: string;
        to: string;
        value: string;
        blockNumber?: number;
      };
      cached?: boolean;
      nft?: { txHash: string; contractAddress: string; tokenId: string; amount: string };
    }) => {
      res.json({
        ok: true,
        cached: params.cached,
        membership: { planId },
        payment: params.payment,
        nft: params.nft,
      });
    };

    // If payment is already settled, avoid re-settling. Mint NFT (if needed) and return.
    if (existing && existing.status === 'settled') {
      const fromAddress = existing.fromAddress.toLowerCase();
      const settleTxHash = existing.txHash;
      if (!settleTxHash) {
        res.status(500).json({ error: 'Payment record missing txHash for settled payment' });
        return;
      }

      // Backfill context for older records (optional)
      if (!existing.kind || !existing.membershipPlanId) {
        await updatePaymentContext(paymentId, { kind: 'membership', membershipPlanId: planId });
      }

      if (useMembershipNft) {
        const tokenId = getMembershipTokenId(slug).toString();
        const contractAddress = membershipNftContract as string;

        if (existing.nftTxHash) {
          logger.info('Returning cached membership (already minted)', { paymentId });
          await upsertMembership(fromAddress, { reactivate: false });
          buildSuccessResponse({
            cached: true,
            payment: {
              paymentId,
              txHash: settleTxHash,
              from: existing.fromAddress,
              to: existing.toAddress,
              value: existing.value,
            },
            nft: { txHash: existing.nftTxHash, contractAddress, tokenId, amount: '1' },
          });
          return;
        }

        // Retry minting if previous attempt failed after settlement.
        try {
          const mintResult = await mintMembershipNft({ network: channel.network, slug, toAddress: fromAddress, amount: 1n });
          await markPaymentNftMinted(paymentId, mintResult.txHash);
          await upsertMembership(fromAddress, { reactivate: false });

          buildSuccessResponse({
            payment: {
              paymentId,
              txHash: settleTxHash,
              from: existing.fromAddress,
              to: existing.toAddress,
              value: existing.value,
            },
            nft: { txHash: mintResult.txHash, contractAddress, tokenId, amount: '1' },
          });
          return;
        } catch (err) {
          const message = (err as Error).message;
          await markPaymentNftFailed(paymentId, message);
          res.status(500).json({ error: 'Membership NFT mint failed', reason: message });
          return;
        }
      }

      // Legacy: settle already complete, just ensure membership is active and return.
      await upsertMembership(fromAddress, { reactivate: false });
      logger.info('Returning cached legacy membership (already settled)', { paymentId });
      buildSuccessResponse({
        cached: true,
        payment: {
          paymentId,
          txHash: settleTxHash,
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
    if (await isWalletBlocked(channel.id, fromAddress)) {
      logger.warn('Blocked wallet attempted membership', { paymentId, fromAddress, planId });
      res.status(403).json({ error: 'Your wallet has been blocked from this channel' });
      return;
    }

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

    let nftInfo: { txHash: string; contractAddress: string; tokenId: string; amount: string } | undefined;

    if (useMembershipNft) {
      try {
        const mintResult = await mintMembershipNft({ network: channel.network, slug, toAddress: fromAddress, amount: 1n });
        await markPaymentNftMinted(paymentId, mintResult.txHash);
        nftInfo = { txHash: mintResult.txHash, contractAddress: membershipNftContract as string, tokenId: getMembershipTokenId(slug).toString(), amount: '1' };
      } catch (err) {
        const message = (err as Error).message;
        await markPaymentNftFailed(paymentId, message);
        res.status(500).json({ error: 'Membership NFT mint failed', reason: message });
        return;
      }
    }

    await upsertMembership(fromAddress, { reactivate: true });

    // Emit unified support.alert
    emitSupportAlert(slug, {
      kind: 'membership',
      paymentId,
      value: settleResult.value,
      fromAddress: settleResult.from,
      txHash: settleResult.txHash,
      timestamp: Date.now(),
      membershipPlanId: planId,
    });

    // Update donation goal progress (membership payments count as donations)
    await updateDonationGoalProgress(slug, channel.id, settleResult.value);

    // Update membership goal progress (count active members)
    await updateMembershipGoalProgress(slug, channel.id, channel.network);

    logger.info('Membership created/renewed', { paymentId, fromAddress, planId, nft: Boolean(nftInfo) });

    buildSuccessResponse({
      payment: {
        paymentId,
        txHash: settleResult.txHash,
        from: settleResult.from,
        to: settleResult.to,
        value: settleResult.value,
        blockNumber: normalizeBlockNumber(settleResult.blockNumber),
      },
      nft: nftInfo,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
