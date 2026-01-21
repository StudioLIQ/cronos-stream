import { v4 as uuid } from 'uuid';
import { queryOne, execute, transaction } from './db.js';
import { logger } from '../logger.js';

interface Channel {
  id: string;
  slug: string;
}

const SELLER_WALLET = process.env.SELLER_WALLET || '0x0000000000000000000000000000000000000000';
const DEFAULT_NETWORK = process.env.DEFAULT_NETWORK || 'cronos-testnet';

function buildDemoStreamEmbedUrl(): string | null {
  const explicit = process.env.DEMO_STREAM_EMBED_URL?.trim();
  if (explicit) return explicit;

  const youtubeChannelId = process.env.DEMO_YOUTUBE_CHANNEL_ID?.trim();
  if (youtubeChannelId) {
    return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(youtubeChannelId)}`;
  }

  const youtubeVideoId = process.env.DEMO_YOUTUBE_VIDEO_ID?.trim();
  if (youtubeVideoId) {
    return `https://www.youtube.com/embed/${encodeURIComponent(youtubeVideoId)}`;
  }

  // Default demo stream (no config needed)
  return 'https://www.youtube.com/embed/Ap-UM1O9RBU';
}

export async function seed(): Promise<void> {
  const existing = await queryOne<Channel>('SELECT id, slug FROM channels WHERE slug = ?', ['demo']);

  if (existing) {
    logger.info('Demo channel already exists, skipping seed');
    return;
  }

  logger.info('Seeding demo channel and actions...');

  await transaction(async (conn) => {
    const channelId = uuid();
    const streamEmbedUrl = buildDemoStreamEmbedUrl();

    await execute(
      `INSERT INTO channels (id, slug, displayName, payToAddress, network, streamEmbedUrl)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [channelId, 'demo', 'Demo Channel', SELLER_WALLET, DEFAULT_NETWORK, streamEmbedUrl],
      conn
    );

    // Sticker action
    await execute(
      `INSERT INTO actions (id, channelId, actionKey, type, priceBaseUnits, payloadJson, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        channelId,
        'sticker_01',
        'sticker',
        '50000',
        JSON.stringify({
          imageUrl: 'https://em-content.zobj.net/source/apple/391/fire_1f525.png',
          durationMs: 3000,
        }),
        1,
      ],
      conn
    );

    // Flash action
    await execute(
      `INSERT INTO actions (id, channelId, actionKey, type, priceBaseUnits, payloadJson, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        channelId,
        'flash_01',
        'flash',
        '50000',
        JSON.stringify({
          color: '#ffffff',
          durationMs: 500,
        }),
        1,
      ],
      conn
    );

    // Sound action
    await execute(
      `INSERT INTO actions (id, channelId, actionKey, type, priceBaseUnits, payloadJson, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        channelId,
        'sound_airhorn',
        'sound',
        '50000',
        JSON.stringify({
          audioUrl: 'https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3',
          durationMs: 2000,
        }),
        1,
      ],
      conn
    );
  });

  logger.info('Seed complete');
}
