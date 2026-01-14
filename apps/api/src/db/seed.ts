import { v4 as uuid } from 'uuid';
import { queryOne, execute, transaction } from './db.js';
import { logger } from '../logger.js';

interface Channel {
  id: string;
  slug: string;
}

const SELLER_WALLET = process.env.SELLER_WALLET || '0x0000000000000000000000000000000000000000';
const DEFAULT_NETWORK = process.env.DEFAULT_NETWORK || 'cronos-testnet';

export function seed(): void {
  const existing = queryOne<Channel>('SELECT id, slug FROM channels WHERE slug = ?', ['demo']);

  if (existing) {
    logger.info('Demo channel already exists, skipping seed');
    return;
  }

  logger.info('Seeding demo channel and actions...');

  transaction(() => {
    const channelId = uuid();

    execute(
      `INSERT INTO channels (id, slug, displayName, payToAddress, network)
       VALUES (?, ?, ?, ?, ?)`,
      [channelId, 'demo', 'Demo Channel', SELLER_WALLET, DEFAULT_NETWORK]
    );

    // Sticker action
    execute(
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
      ]
    );

    // Flash action
    execute(
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
      ]
    );

    // Sound action
    execute(
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
      ]
    );
  });

  logger.info('Seed complete');
}
