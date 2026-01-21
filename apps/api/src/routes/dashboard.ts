import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { queryOne, queryAll, execute } from '../db/db.js';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { getChannelBySlug } from './public.js';
import { broadcastToOverlay, broadcastToDashboard, broadcastToAll } from '../sse/broker.js';

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

  // YouTube channel ID (preferred for "currently live" embeds)
  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
    return {
      ok: true,
      url: `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(trimmed)}`,
    };
  }

  // YouTube video ID (11 chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return { ok: true, url: `https://www.youtube.com/embed/${encodeURIComponent(trimmed)}` };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Only https URLs are allowed' };
  }

  const host = url.hostname.replace(/^www\./, '');

  // Convert common YouTube URLs to embed URLs.
  if (host === 'youtu.be') {
    const videoId = url.pathname.replace(/^\//, '').split('/')[0];
    if (!videoId) return { ok: false, error: 'Invalid youtu.be URL' };
    return { ok: true, url: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` };
  }

  if (host === 'youtube.com') {
    // Already an embed URL
    if (url.pathname.startsWith('/embed/')) {
      return { ok: true, url: url.toString() };
    }

    // /watch?v=VIDEO_ID
    if (url.pathname === '/watch') {
      const videoId = url.searchParams.get('v');
      if (!videoId) return { ok: false, error: 'Missing v= parameter' };
      return { ok: true, url: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` };
    }

    // /live/VIDEO_ID
    if (url.pathname.startsWith('/live/')) {
      const videoId = url.pathname.split('/')[2];
      if (!videoId) return { ok: false, error: 'Invalid /live URL' };
      return { ok: true, url: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}` };
    }

    // /channel/CHANNEL_ID
    if (url.pathname.startsWith('/channel/')) {
      const channelId = url.pathname.split('/')[2];
      if (!channelId) return { ok: false, error: 'Invalid /channel URL' };
      return {
        ok: true,
        url: `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channelId)}`,
      };
    }
  }

  if (host === 'youtube-nocookie.com') {
    if (url.pathname.startsWith('/embed/')) {
      return { ok: true, url: url.toString() };
    }
  }

  return {
    ok: false,
    error:
      'Unsupported stream URL. Provide a YouTube channel ID (UC...), a YouTube video ID, or a YouTube URL.',
  };
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
  createdAt: string;
  shownAt: string | null;
  closedAt: string | null;
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

export default router;
