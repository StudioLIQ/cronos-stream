import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { queryOne, queryAll, execute } from '../db/db.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { getChannelBySlug } from './public.js';
import { broadcastToOverlay, broadcastToDashboard, broadcastToAll } from '../sse/broker.js';
import { getEffectiveDisplayName } from './profile.js';
import { toYouTubeEmbedUrl } from '../lib/youtube.js';
import { getMembershipNftContractAddress } from '../lib/membershipNft.js';

const router = Router();

function nowUtcMysqlDatetime(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// Auth middleware
function dashboardAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== config.dashboardToken) {
    res.status(403).json({ error: 'Invalid token' });
    return;
  }

  next();
}

router.use(dashboardAuth);

function normalizeStreamEmbedUrl(
  value: unknown
): { ok: true; url: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, url: null };
  }

  if (typeof value !== 'string') {
    return { ok: false, error: 'streamEmbedUrl must be a string or null' };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, url: null };
  }

  const embedUrl = toYouTubeEmbedUrl(trimmed);
  if (!embedUrl) {
    return {
      ok: false,
      error:
        'Unsupported stream URL. Provide a YouTube channel ID (UC...), a YouTube video ID, or a YouTube URL.',
    };
  }

  return { ok: true, url: embedUrl };
}

interface QaItemRow {
  id: string;
  channelId: string;
  paymentId: string;
  fromAddress: string;
  displayName: string | null;
  message: string;
  tier: string;
  priceBaseUnits: string;
  status: string;
  isMember: number;
  memberPlanId: string | null;
  createdAt: string;
  shownAt: string | null;
  closedAt: string | null;
}

interface PaymentRow {
  id: string;
  channelId: string;
  paymentId: string;
  status: string;
  scheme: string;
  network: string;
  asset: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  nonce: string;
  txHash: string | null;
  blockNumber: string | null;
  timestamp: string | null;
  error: string | null;
  kind: string | null;
  actionKey: string | null;
  qaId: string | null;
  membershipPlanId: string | null;
  createdAt: string;
}

interface MembershipRow {
  id: string;
  channelId: string;
  fromAddress: string;
  planId: string;
  expiresAt: string;
  lastPaymentId: string | null;
  revoked: number;
  createdAt: string;
  updatedAt: string;
  planName?: string;
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
  createdAt: string;
  updatedAt: string;
}

// PATCH /api/channels/:slug - Update channel settings (dashboard auth)
router.patch('/channels/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const normalized = normalizeStreamEmbedUrl(req.body?.streamEmbedUrl);
    if (!normalized.ok) {
      res.status(400).json({ error: normalized.error });
      return;
    }

    await execute('UPDATE channels SET streamEmbedUrl = ? WHERE id = ?', [
      normalized.url,
      channel.id,
    ]);

    res.json({ ok: true, streamEmbedUrl: normalized.url });
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:slug/qa - Get Q&A items by status
router.get('/channels/:slug/qa', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const status = (req.query.status as string) || 'queued';

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const items = await queryAll<QaItemRow>(
      `SELECT * FROM qa_items WHERE channelId = ? AND status = ? ORDER BY
       CASE tier WHEN 'priority' THEN 0 ELSE 1 END,
       createdAt ASC`,
      [channel.id, status]
    );

    res.json(
      items.map((item) => ({
        id: item.id,
        fromAddress: item.fromAddress,
        displayName: item.displayName,
        message: item.message,
        tier: item.tier,
        priceBaseUnits: item.priceBaseUnits,
        status: item.status,
        isMember: item.isMember === 1,
        memberPlanId: item.memberPlanId,
        createdAt: item.createdAt,
        shownAt: item.shownAt,
        closedAt: item.closedAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/:slug/qa/:id/state - Update Q&A state
router.post('/channels/:slug/qa/:id/state', async (req, res, next) => {
  try {
    const { slug, id } = req.params;
    const { state } = req.body;

    const validStates = ['show', 'answered', 'skipped', 'blocked'];
    if (!state || !validStates.includes(state)) {
      res.status(400).json({ error: `Invalid state. Must be one of: ${validStates.join(', ')}` });
      return;
    }

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const qaItem = await queryOne<QaItemRow>(
      'SELECT * FROM qa_items WHERE id = ? AND channelId = ?',
      [id, channel.id]
    );

    if (!qaItem) {
      res.status(404).json({ error: 'Q&A item not found' });
      return;
    }

    const now = nowUtcMysqlDatetime();

    if (state === 'show') {
      // Update status to showing
      await execute(
        `UPDATE qa_items SET status = 'showing', shownAt = ? WHERE id = ?`,
        [now, id]
      );

      // Emit qa.show to overlay
      broadcastToOverlay(slug, 'qa.show', {
        qaId: id,
        message: qaItem.message,
        tier: qaItem.tier,
        displayName: qaItem.displayName,
        isMember: qaItem.isMember === 1,
      });

      // Emit qa.updated to dashboard
      broadcastToDashboard(slug, 'qa.updated', {
        qaId: id,
        status: 'showing',
      });

      logger.info('Q&A shown', { qaId: id });
    } else if (state === 'blocked') {
      // Block the wallet
      const blockId = uuid();
      try {
        await execute(
          `INSERT INTO blocks (id, channelId, fromAddress, reason) VALUES (?, ?, ?, ?)`,
          [blockId, channel.id, qaItem.fromAddress.toLowerCase(), 'Blocked via dashboard']
        );
      } catch {
        // Might already be blocked (unique constraint), ignore
      }

      // Update Q&A status
      await execute(
        `UPDATE qa_items SET status = 'blocked', closedAt = ? WHERE id = ?`,
        [now, id]
      );

      // Emit qa.updated
      broadcastToDashboard(slug, 'qa.updated', {
        qaId: id,
        status: 'blocked',
      });

      logger.info('Q&A blocked', { qaId: id, fromAddress: qaItem.fromAddress });
    } else {
      // answered or skipped
      await execute(
        `UPDATE qa_items SET status = ?, closedAt = ? WHERE id = ?`,
        [state, now, id]
      );

      // Emit qa.updated
      broadcastToDashboard(slug, 'qa.updated', {
        qaId: id,
        status: state,
      });

      logger.info(`Q&A ${state}`, { qaId: id });
    }

    res.json({ ok: true, qaId: id, status: state === 'show' ? 'showing' : state });
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:slug/supports - Get support history (dashboard auth)
// Query params: from (wallet address), kind (effect|qa|donation|membership), cursor, limit
router.get('/channels/:slug/supports', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const fromAddress = (req.query.from as string)?.toLowerCase();
    const kind = req.query.kind as string | undefined;
    const cursor = req.query.cursor as string | undefined;
    const limitParam = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 20;

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Validate kind if provided
    const validKinds = ['effect', 'qa', 'donation', 'membership'];
    if (kind && !validKinds.includes(kind)) {
      res.status(400).json({ error: `Invalid kind. Must be one of: ${validKinds.join(', ')}` });
      return;
    }

    // Build query
    const conditions: string[] = ['channelId = ?', 'status = ?'];
    const params: (string | number)[] = [channel.id, 'settled'];

    if (fromAddress) {
      conditions.push('fromAddress = ?');
      params.push(fromAddress);
    }

    if (kind) {
      conditions.push('kind = ?');
      params.push(kind);
    }

    // Cursor-based pagination using timestamp (newest-first)
    if (cursor) {
      // cursor is base64 encoded timestamp
      try {
        const cursorTimestamp = Buffer.from(cursor, 'base64').toString('utf-8');
        conditions.push('timestamp < ?');
        params.push(cursorTimestamp);
      } catch {
        res.status(400).json({ error: 'Invalid cursor' });
        return;
      }
    }

    params.push(limit + 1); // fetch one extra to determine if there are more

    const sql = `
      SELECT * FROM payments
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT ?
    `;

    const rows = await queryAll<PaymentRow>(sql, params);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    // Get displayName for Q&A items
    const qaIds = items.filter((r) => r.qaId).map((r) => r.qaId as string);
    let qaDisplayNames: Record<string, string | null> = {};
    if (qaIds.length > 0) {
      const qaRows = await queryAll<{ id: string; displayName: string | null }>(
        `SELECT id, displayName FROM qa_items WHERE id IN (${qaIds.map(() => '?').join(',')})`,
        qaIds
      );
      qaDisplayNames = Object.fromEntries(qaRows.map((r) => [r.id, r.displayName]));
    }

    // Get displayNames from wallet profiles for non-Q&A items
    const walletDisplayNames: Record<string, string | null> = {};
    const uniqueAddresses = [...new Set(items.map((r) => r.fromAddress.toLowerCase()))];
    for (const addr of uniqueAddresses) {
      const effectiveName = await getEffectiveDisplayName(channel.id, addr);
      walletDisplayNames[addr] = effectiveName;
    }

    const result = items.map((row) => ({
      paymentId: row.paymentId,
      kind: row.kind,
      value: row.value,
      txHash: row.txHash,
      timestamp: row.timestamp ? Number(row.timestamp) : null,
      actionKey: row.actionKey,
      qaId: row.qaId,
      fromAddress: row.fromAddress,
      displayName: row.qaId
        ? qaDisplayNames[row.qaId]
        : walletDisplayNames[row.fromAddress.toLowerCase()],
    }));

    // Generate next cursor
    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      if (lastItem.timestamp) {
        nextCursor = Buffer.from(lastItem.timestamp).toString('base64');
      }
    }

    res.json({
      items: result,
      nextCursor,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:slug/leaderboard - Get top supporters (dashboard auth)
// Query params: period (all|30d|7d|24h), limit
router.get('/channels/:slug/leaderboard', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const period = (req.query.period as string) || 'all';
    const limitParam = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 20;

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Validate period
    const validPeriods = ['all', '30d', '7d', '24h'];
    if (!validPeriods.includes(period)) {
      res.status(400).json({ error: `Invalid period. Must be one of: ${validPeriods.join(', ')}` });
      return;
    }

    // Calculate timestamp cutoff based on period
    let timestampCutoff: number | null = null;
    const now = Math.floor(Date.now() / 1000);
    switch (period) {
      case '24h':
        timestampCutoff = now - 24 * 60 * 60;
        break;
      case '7d':
        timestampCutoff = now - 7 * 24 * 60 * 60;
        break;
      case '30d':
        timestampCutoff = now - 30 * 24 * 60 * 60;
        break;
      // 'all' - no cutoff
    }

    // Build query with conditional timestamp filter
    const conditions: string[] = ['channelId = ?', 'status = ?'];
    const params: (string | number)[] = [channel.id, 'settled'];

    if (timestampCutoff !== null) {
      conditions.push('timestamp >= ?');
      params.push(timestampCutoff);
    }

    params.push(limit);

    // Aggregate by fromAddress
    // Use CAST to ensure value is treated as numeric for SUM
    const sql = `
      SELECT
        fromAddress,
        CAST(SUM(CAST(value AS UNSIGNED)) AS CHAR) as totalValueBaseUnits,
        COUNT(*) as supportCount,
        MAX(timestamp) as lastSupportedAt
      FROM payments
      WHERE ${conditions.join(' AND ')}
      GROUP BY fromAddress
      ORDER BY SUM(CAST(value AS UNSIGNED)) DESC, MAX(timestamp) DESC
      LIMIT ?
    `;

    interface LeaderboardRow {
      fromAddress: string;
      totalValueBaseUnits: string;
      supportCount: number;
      lastSupportedAt: string | null;
    }

    const rows = await queryAll<LeaderboardRow>(sql, params);

    // Get displayNames for wallets from wallet profiles
    const walletDisplayNames: Record<string, string | null> = {};
    for (const row of rows) {
      const effectiveName = await getEffectiveDisplayName(channel.id, row.fromAddress);
      walletDisplayNames[row.fromAddress.toLowerCase()] = effectiveName;
    }

    const result = rows.map((row) => ({
      fromAddress: row.fromAddress,
      totalValueBaseUnits: row.totalValueBaseUnits,
      supportCount: Number(row.supportCount),
      lastSupportedAt: row.lastSupportedAt ? Number(row.lastSupportedAt) : null,
      displayName: walletDisplayNames[row.fromAddress.toLowerCase()],
    }));

    res.json({
      period,
      items: result,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:slug/memberships - List members (dashboard auth)
router.get('/channels/:slug/memberships', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const search = (req.query.search as string)?.toLowerCase();
    const status = req.query.status as string | undefined; // 'active' | 'expired' | 'revoked' | 'all'

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const membershipNftContract = getMembershipNftContractAddress(channel.network);

    // Build query
    const conditions: string[] = ['m.channelId = ?'];
    const params: (string | number)[] = [channel.id];

    if (search) {
      conditions.push('m.fromAddress LIKE ?');
      params.push(`%${search}%`);
    }

    if (status === 'active') {
      conditions.push('m.revoked = 0');
      if (membershipNftContract) {
        conditions.push('mp.mintCount IS NOT NULL');
      }
    } else if (status === 'expired') {
      // In NFT mode, "expired" is treated as "inactive" (no membership NFT minted yet).
      if (membershipNftContract) {
        conditions.push('m.revoked = 0 AND mp.mintCount IS NULL');
      } else {
        conditions.push('1 = 0');
      }
    } else if (status === 'revoked') {
      conditions.push('m.revoked = 1');
    }
    // 'all' or undefined = no filter

    interface MembershipListRow extends MembershipRow {
      planName: string;
      mintCount: number | null;
      memberSince: string | null;
    }

    const sql = `
      SELECT m.*, p.name as planName, mp.mintCount as mintCount, mp.memberSince as memberSince
      FROM memberships m
      JOIN membership_plans p ON m.planId = p.id
      LEFT JOIN (
        SELECT channelId, fromAddress, COUNT(*) as mintCount, MIN(createdAt) as memberSince
        FROM payments
        WHERE kind = 'membership' AND status = 'settled' AND nftTxHash IS NOT NULL
        GROUP BY channelId, fromAddress
      ) mp ON mp.channelId = m.channelId AND mp.fromAddress = m.fromAddress
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.createdAt DESC
      LIMIT 100
    `;

    const rows = await queryAll<MembershipListRow>(sql, params);

    const result = rows.map((row) => {
      const isRevoked = row.revoked === 1;
      const hasNft = (row.mintCount || 0) > 0;
      const isActive = !isRevoked && (membershipNftContract ? hasNft : true);

      return {
        id: row.id,
        fromAddress: row.fromAddress,
        planId: row.planId,
        planName: row.planName,
        memberSince: membershipNftContract ? row.memberSince : row.createdAt,
        revoked: isRevoked,
        active: isActive,
        createdAt: row.createdAt,
      };
    });

    res.json({ items: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/:slug/memberships/:address/revoke - Revoke membership (dashboard auth)
router.post('/channels/:slug/memberships/:address/revoke', async (req, res, next) => {
  try {
    const { slug, address } = req.params;
    const normalizedAddress = address.toLowerCase();

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const membership = await queryOne<MembershipRow>(
      'SELECT * FROM memberships WHERE channelId = ? AND fromAddress = ?',
      [channel.id, normalizedAddress]
    );

    if (!membership) {
      res.status(404).json({ error: 'Membership not found' });
      return;
    }

    if (membership.revoked) {
      res.json({ ok: true, message: 'Already revoked' });
      return;
    }

    await execute(
      'UPDATE memberships SET revoked = 1, updatedAt = NOW() WHERE id = ?',
      [membership.id]
    );

    logger.info('Membership revoked', { channelId: channel.id, address: normalizedAddress });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/:slug/demo/reset - Reset demo data (dev/demo only)
router.post('/channels/:slug/demo/reset', async (req, res, next) => {
  try {
    const { slug } = req.params;

    // Only allow reset for 'demo' channel as a guardrail
    if (slug !== 'demo') {
      res.status(403).json({ error: 'Demo reset is only allowed for the demo channel' });
      return;
    }

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Clear Q&A items (keep only non-queued for history)
    await execute(
      'DELETE FROM qa_items WHERE channelId = ? AND status = ?',
      [channel.id, 'queued']
    );

    // Clear blocks
    await execute(
      'DELETE FROM blocks WHERE channelId = ?',
      [channel.id]
    );

    // Clear recent payments (optional - keep for audit trail)
    // Not deleting payments to maintain idempotency

    logger.info('Demo data reset', { channelId: channel.id, slug });

    res.json({
      ok: true,
      message: 'Demo data reset successfully',
    });
  } catch (err) {
    next(err);
  }
});

// T9.3: Goals endpoints

// GET /api/channels/:slug/goals - List goals (dashboard auth)
router.get('/channels/:slug/goals', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const goals = await queryAll<GoalRow>(
      'SELECT * FROM goals WHERE channelId = ? ORDER BY createdAt DESC',
      [channel.id]
    );

    res.json({
      items: goals.map((g) => ({
        id: g.id,
        type: g.type,
        name: g.name,
        targetValue: g.targetValue,
        currentValue: g.currentValue,
        startsAt: g.startsAt,
        endsAt: g.endsAt,
        enabled: g.enabled === 1,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/:slug/goals - Create goal (dashboard auth)
router.post('/channels/:slug/goals', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { type, name, targetValue, startsAt, endsAt } = req.body;

    // Validate type
    if (!type || !['donation', 'membership'].includes(type)) {
      res.status(400).json({ error: 'Invalid type. Must be "donation" or "membership"' });
      return;
    }

    // Validate name
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    // Validate targetValue (must be numeric string for donation, positive int for membership)
    if (!targetValue) {
      res.status(400).json({ error: 'targetValue is required' });
      return;
    }

    if (type === 'donation') {
      if (!/^\d+$/.test(targetValue) || BigInt(targetValue) <= 0n) {
        res.status(400).json({ error: 'targetValue must be a positive integer string (base units)' });
        return;
      }
    } else {
      const parsed = parseInt(targetValue, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        res.status(400).json({ error: 'targetValue must be a positive integer for membership goals' });
        return;
      }
    }

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const goalId = uuid();
    const now = nowUtcMysqlDatetime();

    await execute(
      `INSERT INTO goals (id, channelId, type, name, targetValue, currentValue, startsAt, endsAt, enabled, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, '0', ?, ?, 1, ?, ?)`,
      [
        goalId,
        channel.id,
        type,
        name.trim(),
        targetValue,
        startsAt || null,
        endsAt || null,
        now,
        now,
      ]
    );

    logger.info('Goal created', { goalId, channelId: channel.id, type, name: name.trim() });

    res.status(201).json({
      ok: true,
      goal: {
        id: goalId,
        type,
        name: name.trim(),
        targetValue,
        currentValue: '0',
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        enabled: true,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/channels/:slug/goals/:goalId - Update goal (dashboard auth)
router.patch('/channels/:slug/goals/:goalId', async (req, res, next) => {
  try {
    const { slug, goalId } = req.params;
    const { name, targetValue, currentValue, startsAt, endsAt, enabled } = req.body;

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const goal = await queryOne<GoalRow>(
      'SELECT * FROM goals WHERE id = ? AND channelId = ?',
      [goalId, channel.id]
    );

    if (!goal) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }

    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Name must be a non-empty string' });
        return;
      }
      updates.push('name = ?');
      params.push(name.trim());
    }

    if (targetValue !== undefined) {
      if (goal.type === 'donation') {
        if (!/^\d+$/.test(targetValue) || BigInt(targetValue) <= 0n) {
          res.status(400).json({ error: 'targetValue must be a positive integer string' });
          return;
        }
      } else {
        const parsed = parseInt(targetValue, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          res.status(400).json({ error: 'targetValue must be a positive integer' });
          return;
        }
      }
      updates.push('targetValue = ?');
      params.push(targetValue);
    }

    if (currentValue !== undefined) {
      if (!/^\d+$/.test(currentValue)) {
        res.status(400).json({ error: 'currentValue must be a non-negative integer string' });
        return;
      }
      updates.push('currentValue = ?');
      params.push(currentValue);
    }

    if (startsAt !== undefined) {
      updates.push('startsAt = ?');
      params.push(startsAt || null);
    }

    if (endsAt !== undefined) {
      updates.push('endsAt = ?');
      params.push(endsAt || null);
    }

    if (enabled !== undefined) {
      updates.push('enabled = ?');
      params.push(enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push('updatedAt = NOW()');
    params.push(goalId, channel.id);

    await execute(
      `UPDATE goals SET ${updates.join(', ')} WHERE id = ? AND channelId = ?`,
      params
    );

    // Fetch updated goal
    const updatedGoal = await queryOne<GoalRow>(
      'SELECT * FROM goals WHERE id = ?',
      [goalId]
    );

    // Broadcast goal update to overlay
    if (updatedGoal && updatedGoal.enabled) {
      broadcastToOverlay(slug, 'goal.updated', {
        id: updatedGoal.id,
        type: updatedGoal.type,
        name: updatedGoal.name,
        targetValue: updatedGoal.targetValue,
        currentValue: updatedGoal.currentValue,
        enabled: updatedGoal.enabled === 1,
      });
    }

    logger.info('Goal updated', { goalId, channelId: channel.id });

    res.json({
      ok: true,
      goal: updatedGoal
        ? {
            id: updatedGoal.id,
            type: updatedGoal.type,
            name: updatedGoal.name,
            targetValue: updatedGoal.targetValue,
            currentValue: updatedGoal.currentValue,
            startsAt: updatedGoal.startsAt,
            endsAt: updatedGoal.endsAt,
            enabled: updatedGoal.enabled === 1,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/channels/:slug/goals/:goalId - Delete goal (dashboard auth)
router.delete('/channels/:slug/goals/:goalId', async (req, res, next) => {
  try {
    const { slug, goalId } = req.params;

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const goal = await queryOne<GoalRow>(
      'SELECT * FROM goals WHERE id = ? AND channelId = ?',
      [goalId, channel.id]
    );

    if (!goal) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }

    await execute(
      'DELETE FROM goals WHERE id = ? AND channelId = ?',
      [goalId, channel.id]
    );

    // Broadcast goal removal to overlay
    broadcastToOverlay(slug, 'goal.removed', { id: goalId });

    logger.info('Goal deleted', { goalId, channelId: channel.id });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/channels/:slug/goals/:goalId/reset - Reset goal progress (dashboard auth)
router.post('/channels/:slug/goals/:goalId/reset', async (req, res, next) => {
  try {
    const { slug, goalId } = req.params;

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const goal = await queryOne<GoalRow>(
      'SELECT * FROM goals WHERE id = ? AND channelId = ?',
      [goalId, channel.id]
    );

    if (!goal) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }

    await execute(
      "UPDATE goals SET currentValue = '0', updatedAt = NOW() WHERE id = ?",
      [goalId]
    );

    // Broadcast goal update to overlay
    if (goal.enabled) {
      broadcastToOverlay(slug, 'goal.updated', {
        id: goal.id,
        type: goal.type,
        name: goal.name,
        targetValue: goal.targetValue,
        currentValue: '0',
        enabled: true,
      });
    }

    logger.info('Goal reset', { goalId, channelId: channel.id });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// T10.11: Dashboard KPI cards

// GET /api/channels/:slug/stats - Get channel statistics (dashboard auth)
router.get('/channels/:slug/stats', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const membershipNftContract = getMembershipNftContractAddress(channel.network);

    // Total revenue (all settled payments)
    const revenueResult = await queryOne<{ total: string | null }>(
      `SELECT SUM(CAST(value AS DECIMAL(38, 0))) as total
       FROM payments WHERE channelId = ? AND status = 'settled'`,
      [channel.id]
    );
    const totalRevenue = revenueResult?.total || '0';

    // Total supporters (unique addresses)
    const supportersResult = await queryOne<{ count: number }>(
      `SELECT COUNT(DISTINCT fromAddress) as count
       FROM payments WHERE channelId = ? AND status = 'settled'`,
      [channel.id]
    );
    const totalSupporters = supportersResult?.count || 0;

    // Active members (no expiry; in NFT mode require a minted membership receipt)
    const membersResult = membershipNftContract
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
          [channel.id]
        )
      : await queryOne<{ count: number }>(
          `SELECT COUNT(*) as count FROM memberships
           WHERE channelId = ? AND revoked = 0`,
          [channel.id]
        );
    const activeMembers = membersResult?.count || 0;

    // Queued Q&A items
    const queuedResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM qa_items
       WHERE channelId = ? AND status = 'queued'`,
      [channel.id]
    );
    const queuedQA = queuedResult?.count || 0;

    // Today's revenue
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartStr = todayStart.toISOString().slice(0, 19).replace('T', ' ');

    const todayRevenueResult = await queryOne<{ total: string | null }>(
      `SELECT SUM(CAST(value AS DECIMAL(38, 0))) as total
       FROM payments WHERE channelId = ? AND status = 'settled' AND createdAt >= ?`,
      [channel.id, todayStartStr]
    );
    const todayRevenue = todayRevenueResult?.total || '0';

    // Total transactions
    const transactionsResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM payments WHERE channelId = ? AND status = 'settled'`,
      [channel.id]
    );
    const totalTransactions = transactionsResult?.count || 0;

    res.json({
      totalRevenue,
      todayRevenue,
      totalSupporters,
      activeMembers,
      queuedQA,
      totalTransactions,
    });
  } catch (err) {
    next(err);
  }
});

// T9.4: CSV Export endpoints

// GET /api/channels/:slug/export/supports - Export all supports as CSV data (dashboard auth)
router.get('/channels/:slug/export/supports', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Get all settled payments
    const rows = await queryAll<{
      paymentId: string;
      status: string;
      fromAddress: string;
      value: string;
      txHash: string | null;
      timestamp: string | null;
      kind: string | null;
      actionKey: string | null;
      qaId: string | null;
      createdAt: string;
    }>(
      `SELECT paymentId, status, fromAddress, value, txHash, timestamp, kind, actionKey, qaId, createdAt
       FROM payments
       WHERE channelId = ? AND status = 'settled'
       ORDER BY timestamp DESC`,
      [channel.id]
    );

    // Resolve display names
    const addresses = [...new Set(rows.map((r) => r.fromAddress))];
    const displayNames = new Map<string, string>();

    if (addresses.length > 0) {
      const profileRows = await queryAll<{ address: string; displayName: string }>(
        `SELECT address, displayName FROM wallet_profiles WHERE address IN (${addresses.map(() => '?').join(',')})`,
        addresses
      );
      for (const p of profileRows) {
        displayNames.set(p.address, p.displayName);
      }
    }

    const items = rows.map((row) => ({
      paymentId: row.paymentId,
      fromAddress: row.fromAddress,
      displayName: displayNames.get(row.fromAddress) || null,
      value: row.value,
      kind: row.kind,
      actionKey: row.actionKey,
      qaId: row.qaId,
      txHash: row.txHash,
      timestamp: row.timestamp ? Number(row.timestamp) : null,
      createdAt: row.createdAt,
    }));

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:slug/payments/:paymentId - Get payment receipt (dashboard auth)
router.get('/channels/:slug/payments/:paymentId', async (req, res, next) => {
  try {
    const { slug, paymentId } = req.params;

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const payment = await queryOne<PaymentRow>(
      'SELECT * FROM payments WHERE channelId = ? AND paymentId = ?',
      [channel.id, paymentId]
    );

    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    res.json({
      paymentId: payment.paymentId,
      status: payment.status,
      kind: payment.kind,
      scheme: payment.scheme,
      network: payment.network,
      asset: payment.asset,
      fromAddress: payment.fromAddress,
      toAddress: payment.toAddress,
      value: payment.value,
      nonce: payment.nonce,
      txHash: payment.txHash,
      blockNumber: payment.blockNumber,
      timestamp: payment.timestamp ? Number(payment.timestamp) : null,
      actionKey: payment.actionKey,
      qaId: payment.qaId,
      membershipPlanId: payment.membershipPlanId,
      createdAt: payment.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:slug/export/members - Export all members as CSV data (dashboard auth)
router.get('/channels/:slug/export/members', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const channel = await getChannelBySlug(slug);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const membershipNftContract = getMembershipNftContractAddress(channel.network);

    interface ExportMemberRow extends MembershipRow {
      planName: string;
      mintCount: number | null;
      memberSince: string | null;
    }

    const rows = await queryAll<ExportMemberRow>(
      `SELECT m.*, p.name as planName, mp.mintCount as mintCount, mp.memberSince as memberSince
       FROM memberships m
       JOIN membership_plans p ON m.planId = p.id
       LEFT JOIN (
         SELECT channelId, fromAddress, COUNT(*) as mintCount, MIN(createdAt) as memberSince
         FROM payments
         WHERE kind = 'membership' AND status = 'settled' AND nftTxHash IS NOT NULL
         GROUP BY channelId, fromAddress
       ) mp ON mp.channelId = m.channelId AND mp.fromAddress = m.fromAddress
       WHERE m.channelId = ?
       ORDER BY m.createdAt DESC`,
      [channel.id]
    );

    const items = rows.map((row) => {
      const isRevoked = row.revoked === 1;
      const hasNft = (row.mintCount || 0) > 0;
      const isActive = !isRevoked && (membershipNftContract ? hasNft : true);

      return {
        id: row.id,
        fromAddress: row.fromAddress,
        planId: row.planId,
        planName: row.planName,
        memberSince: membershipNftContract ? row.memberSince : row.createdAt,
        revoked: isRevoked,
        active: isActive,
        createdAt: row.createdAt,
      };
    });

    // Resolve display names
    const addresses = [...new Set(items.map((r) => r.fromAddress))];
    const displayNames = new Map<string, string>();

    if (addresses.length > 0) {
      const profileRows = await queryAll<{ address: string; displayName: string }>(
        `SELECT address, displayName FROM wallet_profiles WHERE address IN (${addresses.map(() => '?').join(',')})`,
        addresses
      );
      for (const p of profileRows) {
        displayNames.set(p.address, p.displayName);
      }
    }

    const itemsWithNames = items.map((item) => ({
      ...item,
      displayName: displayNames.get(item.fromAddress) || null,
    }));

    res.json({ items: itemsWithNames });
  } catch (err) {
    next(err);
  }
});

export default router;
