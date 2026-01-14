import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { queryOne, queryAll, execute } from '../db/db.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { getChannelBySlug } from './public.js';
import { broadcastToOverlay, broadcastToDashboard, broadcastToAll } from '../sse/broker.js';

const router = Router();

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
  createdAt: string;
  shownAt: string | null;
  closedAt: string | null;
}

// GET /api/channels/:slug/qa - Get Q&A items by status
router.get('/channels/:slug/qa', (req, res) => {
  const { slug } = req.params;
  const status = req.query.status as string || 'queued';

  const channel = getChannelBySlug(slug);
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }

  const items = queryAll<QaItemRow>(
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
      createdAt: item.createdAt,
      shownAt: item.shownAt,
      closedAt: item.closedAt,
    }))
  );
});

// POST /api/channels/:slug/qa/:id/state - Update Q&A state
router.post('/channels/:slug/qa/:id/state', (req, res) => {
  const { slug, id } = req.params;
  const { state } = req.body;

  const validStates = ['show', 'answered', 'skipped', 'blocked'];
  if (!state || !validStates.includes(state)) {
    res.status(400).json({ error: `Invalid state. Must be one of: ${validStates.join(', ')}` });
    return;
  }

  const channel = getChannelBySlug(slug);
  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }

  const qaItem = queryOne<QaItemRow>(
    'SELECT * FROM qa_items WHERE id = ? AND channelId = ?',
    [id, channel.id]
  );

  if (!qaItem) {
    res.status(404).json({ error: 'Q&A item not found' });
    return;
  }

  const now = new Date().toISOString();

  if (state === 'show') {
    // Update status to showing
    execute(
      `UPDATE qa_items SET status = 'showing', shownAt = ? WHERE id = ?`,
      [now, id]
    );

    // Emit qa.show to overlay
    broadcastToOverlay(slug, 'qa.show', {
      qaId: id,
      message: qaItem.message,
      tier: qaItem.tier,
      displayName: qaItem.displayName,
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
      execute(
        `INSERT INTO blocks (id, channelId, fromAddress, reason) VALUES (?, ?, ?, ?)`,
        [blockId, channel.id, qaItem.fromAddress.toLowerCase(), 'Blocked via dashboard']
      );
    } catch (err) {
      // Might already be blocked (unique constraint), ignore
    }

    // Update Q&A status
    execute(
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
    execute(
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
});

export default router;
