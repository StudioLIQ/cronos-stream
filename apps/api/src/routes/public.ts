import { Router } from 'express';
import { Contract, JsonRpcProvider } from 'ethers';
import { queryOne, queryAll } from '../db/db.js';
import { config } from '../config.js';
import { NETWORKS, getNetworkConfig } from '../x402/constants.js';
import { checkYouTubeChannelLive } from '../lib/youtubeLive.js';
import { getMembershipNftContractAddress, getMembershipTokenId } from '../lib/membershipNft.js';

const router = Router();

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'] as const;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const resolvedConcurrency = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = new Array(Math.min(resolvedConcurrency, items.length)).fill(null).map(async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

type DashboardOverviewChannel = {
  slug: string;
  displayName: string;
  payToAddress: string;
  network: string;
  chainId: number | null;
  usdcAddress: string | null;
  totalSettledValueBaseUnits: string;
  settledCount: number;
  lastSettledAt: number | null;
  usdcBalanceBaseUnits: string | null;
  usdcBalanceError: string | null;
};

type DashboardOverviewResponse = {
  generatedAt: number;
  channels: DashboardOverviewChannel[];
};

const DASHBOARD_OVERVIEW_TTL_MS = 10_000;
let dashboardOverviewCache: { data: DashboardOverviewResponse; expiresAt: number } | null = null;
let dashboardOverviewInFlight: Promise<DashboardOverviewResponse> | null = null;

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

    const channel = await queryOne<{ id: string; network: string }>('SELECT id, network FROM channels WHERE slug = ?', [slug]);
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
        nft: null,
      });
      return;
    }

    const membershipNftContract = getMembershipNftContractAddress(channel.network);
    const isRevoked = membership.revoked === 1;
    let isActive = !isRevoked;
    let memberSince: string | null = membership.createdAt;

    if (membershipNftContract && !isRevoked) {
      const minted = await queryOne<{ memberSince: string | null; mintCount: number }>(
        `SELECT MIN(createdAt) as memberSince, COUNT(*) as mintCount
         FROM payments
         WHERE channelId = ? AND fromAddress = ?
           AND kind = 'membership' AND status = 'settled' AND nftTxHash IS NOT NULL`,
        [channel.id, address]
      );
      const mintCount = minted?.mintCount || 0;
      isActive = mintCount > 0;
      memberSince = minted?.memberSince || null;
    }

    res.json({
      active: isActive,
      membership: {
        planId: membership.planId,
        planName: membership.planName,
        memberSince,
        revoked: isRevoked,
      },
      nft: membershipNftContract
        ? {
            contractAddress: membershipNftContract,
            tokenId: getMembershipTokenId(slug).toString(),
          }
        : null,
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

// GET /api/channels/:slug/stream/status - Best-effort stream status (used by web UI)
router.get('/channels/:slug/stream/status', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const checkedAt = new Date().toISOString();

    const channel = await queryOne<Pick<ChannelRow, 'streamEmbedUrl'>>(
      'SELECT streamEmbedUrl FROM channels WHERE slug = ?',
      [slug]
    );

    if (!channel) {
      res.status(404).json({ ok: false, checkedAt, error: 'Channel not found' });
      return;
    }

    const embed = (channel.streamEmbedUrl || '').trim();
    if (!embed) {
      res.json({ ok: true, status: 'unconfigured', checkedAt });
      return;
    }

    let url: URL | null = null;
    try {
      url = new URL(embed);
    } catch {
      url = null;
    }

    // Only do expensive checks for YouTube "currently live" embeds.
    // Example: https://www.youtube.com/embed/live_stream?channel=UC...
    const isYouTubeHost =
      url && (url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com'));

    if (url && isYouTubeHost && url.pathname === '/embed/live_stream') {
      const channelId = url.searchParams.get('channel') || '';
      const liveResult = await checkYouTubeChannelLive(channelId);

      if (!liveResult.ok) {
        res.status(502).json({ ok: false, checkedAt, error: liveResult.error });
        return;
      }

      if (!liveResult.isLive) {
        res.json({ ok: true, status: 'offline', platform: 'youtube', checkedAt, reason: liveResult.reason });
        return;
      }

      res.json({
        ok: true,
        status: 'live',
        platform: 'youtube',
        checkedAt,
        videoId: liveResult.videoId,
        embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(liveResult.videoId)}`,
      });
      return;
    }

    res.json({ ok: true, status: 'unknown', checkedAt });
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

// GET /api/channels/:slug/payments/:paymentId - Get payment receipt (public, requires wallet address)
router.get('/channels/:slug/payments/:paymentId', async (req, res, next) => {
  try {
    const { slug, paymentId } = req.params;
    const address = (req.query.address as string)?.toLowerCase();

    // Validate address parameter
    if (!address || !/^0x[a-f0-9]{40}$/i.test(address)) {
      res.status(400).json({ error: 'Missing or invalid address parameter' });
      return;
    }

    // Get channel
    const channel = await queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);
    if (!channel) {
      res.status(404).json({ error: 'Channel not found' });
      return;
    }

    // Get payment
    const payment = await queryOne<PaymentRow>(
      'SELECT * FROM payments WHERE channelId = ? AND paymentId = ?',
      [channel.id, paymentId]
    );

    if (!payment) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    // Verify ownership: fromAddress must match the provided address
    if (payment.fromAddress.toLowerCase() !== address) {
      res.status(403).json({ error: 'Access denied: address does not match payment' });
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

interface ChannelOverviewAggRow {
  id: string;
  slug: string;
  displayName: string;
  payToAddress: string;
  network: string;
  totalSettledValueBaseUnits: string;
  settledCount: number;
  lastSettledAt: string | null;
}

async function buildDashboardOverview(): Promise<DashboardOverviewResponse> {
  const rows = await queryAll<ChannelOverviewAggRow>(
    `SELECT
      c.id,
      c.slug,
      c.displayName,
      c.payToAddress,
      c.network,
      COALESCE(SUM(CAST(p.value AS DECIMAL(65, 0))), 0) AS totalSettledValueBaseUnits,
      COUNT(p.id) AS settledCount,
      MAX(p.timestamp) AS lastSettledAt
    FROM channels c
    LEFT JOIN payments p
      ON p.channelId = c.id
     AND p.status = 'settled'
    GROUP BY c.id
    ORDER BY c.displayName ASC`
  );

  const providerByNetwork = new Map<string, JsonRpcProvider>();
  const tokenByNetwork = new Map<string, Contract>();

  const channels = await mapWithConcurrency(rows, 6, async (row) => {
    const network = row.network || config.defaultNetwork;

    let usdcBalanceBaseUnits: string | null = null;
    let usdcBalanceError: string | null = null;
    let chainId: number | null = null;
    let usdcAddress: string | null = null;

    try {
      const networkConfig = getNetworkConfig(network);
      chainId = networkConfig.chainId;
      usdcAddress = networkConfig.usdcAddress;

      let provider = providerByNetwork.get(network);
      if (!provider) {
        provider = new JsonRpcProvider(networkConfig.rpc, networkConfig.chainId);
        providerByNetwork.set(network, provider);
      }

      let token = tokenByNetwork.get(network);
      if (!token) {
        token = new Contract(networkConfig.usdcAddress, ERC20_BALANCE_ABI, provider);
        tokenByNetwork.set(network, token);
      }

      const balance = (await token.balanceOf(row.payToAddress)) as bigint;
      usdcBalanceBaseUnits = balance.toString();
    } catch (err) {
      usdcBalanceError = (err as Error).message;
    }

    return {
      slug: row.slug,
      displayName: row.displayName,
      payToAddress: row.payToAddress,
      network,
      chainId,
      usdcAddress,
      totalSettledValueBaseUnits: String(row.totalSettledValueBaseUnits ?? '0'),
      settledCount: Number(row.settledCount || 0),
      lastSettledAt: row.lastSettledAt ? Number(row.lastSettledAt) : null,
      usdcBalanceBaseUnits,
      usdcBalanceError,
    } satisfies DashboardOverviewChannel;
  });

  return {
    generatedAt: Date.now(),
    channels,
  };
}

// GET /api/dashboard/overview - Global dashboard overview (no auth; read-only)
router.get('/dashboard/overview', async (_req, res, next) => {
  try {
    const now = Date.now();
    if (dashboardOverviewCache && now < dashboardOverviewCache.expiresAt) {
      res.json(dashboardOverviewCache.data);
      return;
    }

    if (!dashboardOverviewInFlight) {
      dashboardOverviewInFlight = buildDashboardOverview();
    }

    const data = await dashboardOverviewInFlight;
    dashboardOverviewCache = { data, expiresAt: Date.now() + DASHBOARD_OVERVIEW_TTL_MS };
    dashboardOverviewInFlight = null;
    res.json(data);
  } catch (err) {
    dashboardOverviewInFlight = null;
    next(err);
  }
});

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
