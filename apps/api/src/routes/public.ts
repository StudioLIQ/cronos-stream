import { Router } from 'express';
import { queryOne, queryAll } from '../db/db.js';

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
