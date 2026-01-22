import { Router } from 'express';
import { queryOne, queryAll } from '../db/db.js';
import { config } from '../config.js';
import { NETWORKS } from '../x402/constants.js';

const router = Router();

interface ChannelRow {
  id: string;
  slug: string;
  displayName: string;
  payToAddress: string;
  network: string;
  streamEmbedUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ActionRow {
  id: string;
  actionKey: string;
  type: string;
  priceBaseUnits: string;
  payloadJson: string;
  enabled: number;
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

interface MembershipPlanRow {
  id: string;
  channelId: string;
  name: string;
  priceBaseUnits: string;
  durationDays: number;
  enabled: number;
  createdAt: string;
  updatedAt: string;
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

// GET /api/channels/:slug - Get channel info
router.get('/channels/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const channel = await queryOne<ChannelRow>(
      'SELECT id, slug, displayName, payToAddress, network, streamEmbedUrl, createdAt, updatedAt FROM channels WHERE slug = ?',
      [slug]
    );

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    res.json({
      slug: channel.slug,
      displayName: channel.displayName,
      payToAddress: channel.payToAddress,
      network: channel.network,
      streamEmbedUrl: channel.streamEmbedUrl,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:slug/actions - Get enabled actions
router.get('/channels/:slug/actions', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const channel = await queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);

    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const actions = await queryAll<ActionRow>(
      'SELECT actionKey, type, priceBaseUnits, payloadJson FROM actions WHERE channelId = ? AND enabled = 1',
      [channel.id]
    );

    res.json(
      actions.map((a) => ({
        actionKey: a.actionKey,
        type: a.type,
        priceBaseUnits: a.priceBaseUnits,
        payload: JSON.parse(a.payloadJson),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:slug/membership-plans - Get enabled membership plans
router.get('/channels/:slug/membership-plans', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const channel = await queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const plans = await queryAll<MembershipPlanRow>(
      'SELECT id, name, priceBaseUnits, durationDays FROM membership_plans WHERE channelId = ? AND enabled = 1',
      [channel.id]
    );

    res.json(
      plans.map((p) => ({
        id: p.id,
        name: p.name,
        priceBaseUnits: p.priceBaseUnits,
        durationDays: p.durationDays,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:slug/memberships/me - Get membership status for a wallet
router.get('/channels/:slug/memberships/me', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const address = (req.query.address as string)?.toLowerCase();

    if (!address || !/^0x[a-f0-9]{40}$/i.test(address)) {
      res.status(400).json({ error: 'Missing or invalid address parameter' });
      return;
    }

    const channel = await queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const membership = await queryOne<MembershipRow & { planName: string }>(
      `SELECT m.*, p.name as planName
       FROM memberships m
       JOIN membership_plans p ON m.planId = p.id
       WHERE m.channelId = ? AND m.fromAddress = ?`,
      [channel.id, address]
    );

    if (!membership) {
      res.json({
        active: false,
        membership: null,
      });
      return;
    }

    const expiresAt = new Date(membership.expiresAt);
    const now = new Date();
    const isActive = !membership.revoked && expiresAt > now;

    res.json({
      active: isActive,
      membership: {
        planId: membership.planId,
        planName: membership.planName,
        expiresAt: membership.expiresAt,
        revoked: membership.revoked === 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/channels/:slug/supports/me - Get viewer's own support history (public, requires wallet address)
router.get('/channels/:slug/supports/me', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const address = (req.query.address as string)?.toLowerCase();
    const kind = req.query.kind as string | undefined;
    const cursor = req.query.cursor as string | undefined;
    const limitParam = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 20;

    if (!address || !/^0x[a-f0-9]{40}$/i.test(address)) {
      res.status(400).json({ error: 'Missing or invalid address parameter' });
      return;
    }

    const channel = await queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);
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
    const conditions: string[] = ['channelId = ?', 'status = ?', 'fromAddress = ?'];
    const params: (string | number)[] = [channel.id, 'settled', address];

    if (kind) {
      conditions.push('kind = ?');
      params.push(kind);
    }

    // Cursor-based pagination using timestamp (newest-first)
    if (cursor) {
      try {
        const cursorTimestamp = Buffer.from(cursor, 'base64').toString('utf-8');
        conditions.push('timestamp < ?');
        params.push(cursorTimestamp);
      } catch {
        res.status(400).json({ error: 'Invalid cursor' });
        return;
      }
    }

    params.push(limit + 1);

    const sql = `
      SELECT * FROM payments
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT ?
    `;

    const rows = await queryAll<PaymentRow>(sql, params);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const result = items.map((row) => ({
      paymentId: row.paymentId,
      kind: row.kind,
      value: row.value,
      txHash: row.txHash,
      timestamp: row.timestamp ? Number(row.timestamp) : null,
      actionKey: row.actionKey,
      qaId: row.qaId,
    }));

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

// GET /api/status - Server status endpoint
router.get('/status', (_req, res) => {
  const network = config.defaultNetwork;
  const networkConfig = NETWORKS[network];

  res.json({
    status: 'ok',
    network,
    chainId: networkConfig?.chainId || null,
    asset: networkConfig?.usdcAddress || null,
    sellerWallet: config.sellerWallet,
    serverTime: new Date().toISOString(),
  });
});

// GET /api/channels/:slug/goals/active - Get enabled goals for overlay (public)
router.get('/channels/:slug/goals/active', async (req, res, next) => {
  try {
    const { slug } = req.params;

    const channel = await queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Get enabled goals that are currently active (within time window if specified)
    const goals = await queryAll<GoalRow>(
      `SELECT * FROM goals
       WHERE channelId = ? AND enabled = 1
         AND (startsAt IS NULL OR startsAt <= ?)
         AND (endsAt IS NULL OR endsAt >= ?)
       ORDER BY type, createdAt DESC`,
      [channel.id, now, now]
    );

    res.json({
      items: goals.map((g) => ({
        id: g.id,
        type: g.type,
        name: g.name,
        targetValue: g.targetValue,
        currentValue: g.currentValue,
        progress: calculateProgress(g.currentValue, g.targetValue),
        startsAt: g.startsAt,
        endsAt: g.endsAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

function calculateProgress(current: string, target: string): number {
  try {
    const currentNum = BigInt(current);
    const targetNum = BigInt(target);
    if (targetNum === 0n) return 0;
    // Calculate percentage (0-100), capped at 100
    const progressBig = (currentNum * 100n) / targetNum;
    const progress = Number(progressBig);
    return Math.min(progress, 100);
  } catch {
    return 0;
  }
}

export async function getChannelById(slug: string): Promise<ChannelRow | undefined> {
  return queryOne<ChannelRow>(
    'SELECT * FROM channels WHERE slug = ?',
    [slug]
  );
}

export async function getChannelBySlug(slug: string): Promise<ChannelRow | undefined> {
  return getChannelById(slug);
}

export async function getActionForChannel(
  channelId: string,
  actionKey: string
): Promise<ActionRow | undefined> {
  return queryOne<ActionRow>(
    'SELECT * FROM actions WHERE channelId = ? AND actionKey = ? AND enabled = 1',
    [channelId, actionKey]
  );
}

export default router;
