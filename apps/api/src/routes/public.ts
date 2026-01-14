import { Router } from 'express';
import { queryOne, queryAll } from '../db/db.js';

const router = Router();

interface ChannelRow {
  id: string;
  slug: string;
  displayName: string;
  payToAddress: string;
  network: string;
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
router.get('/channels/:slug', (req, res) => {
  const { slug } = req.params;

  const channel = queryOne<ChannelRow>(
    'SELECT id, slug, displayName, payToAddress, network, createdAt, updatedAt FROM channels WHERE slug = ?',
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
  });
});

// GET /api/channels/:slug/actions - Get enabled actions
router.get('/channels/:slug/actions', (req, res) => {
  const { slug } = req.params;

  const channel = queryOne<{ id: string }>('SELECT id FROM channels WHERE slug = ?', [slug]);

  if (!channel) {
    res.status(404).json({ error: 'Channel not found' });
    return;
  }

  const actions = queryAll<ActionRow>(
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
});

export function getChannelById(slug: string): ChannelRow | undefined {
  return queryOne<ChannelRow>(
    'SELECT * FROM channels WHERE slug = ?',
    [slug]
  );
}

export function getChannelBySlug(slug: string): ChannelRow | undefined {
  return getChannelById(slug);
}

export function getActionForChannel(
  channelId: string,
  actionKey: string
): ActionRow | undefined {
  return queryOne<ActionRow>(
    'SELECT * FROM actions WHERE channelId = ? AND actionKey = ? AND enabled = 1',
    [channelId, actionKey]
  );
}

export default router;
