import { v4 as uuid } from 'uuid';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { queryOne, execute, transaction } from './db.js';
import { logger } from '../logger.js';
import { buildSeedChannels } from './seedChannels.js';

interface Channel {
  id: string;
  slug: string;
}

const SELLER_WALLET = process.env.SELLER_WALLET || '0x0000000000000000000000000000000000000000';
const DEFAULT_NETWORK = process.env.DEFAULT_NETWORK || 'cronos-testnet';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type ChannelAddressesFile = Record<string, string | { address?: string; displayName?: string }>;

function resolveRepoRoot(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // apps/api/src/db -> repo root
  return path.resolve(__dirname, '../../../..');
}

function loadChannelPayToAddressBySlug(): Record<string, string> {
  const repoRoot = resolveRepoRoot();
  const addressesPath = path.join(repoRoot, '.WALLET', 'addresses.json');

  if (!existsSync(addressesPath)) return {};

  try {
    const raw = readFileSync(addressesPath, 'utf8');
    const json = JSON.parse(raw) as ChannelAddressesFile;
    const map: Record<string, string> = {};

    for (const [slug, value] of Object.entries(json)) {
      if (typeof value === 'string') {
        map[slug] = value;
        continue;
      }
      if (value && typeof value === 'object' && typeof value.address === 'string') {
        map[slug] = value.address;
      }
    }

    return map;
  } catch (err) {
    logger.warn('Failed to read .WALLET/addresses.json; falling back to SELLER_WALLET', {
      error: (err as Error).message,
    });
    return {};
  }
}

async function ensureDefaultMembershipPlan(channelId: string, conn: Parameters<typeof execute>[2]): Promise<void> {
  // Default membership plan: "Member" - 30 days for $5 USDC
  await execute(
    `INSERT INTO membership_plans (id, channelId, name, priceBaseUnits, durationDays, enabled)
     SELECT ?, ?, ?, ?, ?, ?
     FROM DUAL
     WHERE NOT EXISTS (
       SELECT 1 FROM membership_plans WHERE channelId = ? AND name = ?
     )`,
    [
      uuid(),
      channelId,
      'Member',
      '5000000', // $5 USDC in base units
      30,
      1,
      channelId,
      'Member',
    ],
    conn
  );
}

async function ensureDefaultActions(channelId: string, conn: Parameters<typeof execute>[2]): Promise<void> {
  // Sticker action
  await execute(
    `INSERT INTO actions (id, channelId, actionKey, type, priceBaseUnits, payloadJson, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
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
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
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
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
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
}

export async function seed(): Promise<void> {
  const seedChannels = buildSeedChannels();
  const payToBySlug = loadChannelPayToAddressBySlug();
  logger.info('Seeding channels (ensuring required slugs exist)...', { count: seedChannels.length });

  const createdSlugs: string[] = [];
  const updatedSlugs: string[] = [];

  // Legacy embeds that are known to be broken (YouTube playabilityStatus=ERROR).
  const LEGACY_BROKEN_YOUTUBE_VIDEO_IDS_BY_SLUG: Partial<Record<string, string[]>> = {
    'nbc-news-now': ['0OHUTcdWRLk'],
    'livenow-fox': ['t6wqvEGW7xU'],
    'scripps-news': ['fMUoLkY1SxQ'],
    'fox-weather': ['bIRkeTyn-9c'],
    'weather-channel': ['hTwKbl-s7MQ'],
    'kbs-world': ['26WlVAcPk2w'],
  };

  await transaction(async (conn) => {
    for (const ch of seedChannels) {
      const desiredPayTo = payToBySlug[ch.slug] || SELLER_WALLET;

      const existing = await queryOne<
        Channel & { streamEmbedUrl: string | null; payToAddress: string; network: string }
      >(
        'SELECT id, slug, streamEmbedUrl, payToAddress, network FROM channels WHERE slug = ?',
        [ch.slug],
        conn
      );

      const channelId = existing?.id || uuid();

      if (!existing) {
        await execute(
          `INSERT INTO channels (id, slug, displayName, payToAddress, network, streamEmbedUrl)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [channelId, ch.slug, ch.displayName, desiredPayTo, DEFAULT_NETWORK, ch.streamEmbedUrl],
          conn
        );
        createdSlugs.push(ch.slug);
      } else if (ch.streamEmbedUrl) {
        const legacyIds = LEGACY_BROKEN_YOUTUBE_VIDEO_IDS_BY_SLUG[ch.slug] || [];
        if (
          legacyIds.length > 0 &&
          (existing.streamEmbedUrl === null || legacyIds.some((id) => existing.streamEmbedUrl?.includes(id)))
        ) {
          await execute('UPDATE channels SET streamEmbedUrl = ? WHERE id = ?', [ch.streamEmbedUrl, channelId], conn);
          updatedSlugs.push(ch.slug);
        }
      }

      if (existing) {
        const existingPayTo = existing.payToAddress?.toLowerCase();
        const desiredPayToLower = desiredPayTo.toLowerCase();

        const shouldUpdatePayTo =
          desiredPayToLower !== ZERO_ADDRESS &&
          existingPayTo !== desiredPayToLower &&
          (existingPayTo === ZERO_ADDRESS || existingPayTo === SELLER_WALLET.toLowerCase());

        if (shouldUpdatePayTo) {
          await execute(
            'UPDATE channels SET payToAddress = ?, network = ? WHERE id = ?',
            [desiredPayTo, DEFAULT_NETWORK, channelId],
            conn
          );
          updatedSlugs.push(ch.slug);
        }
      }

      await ensureDefaultActions(channelId, conn);
      await ensureDefaultMembershipPlan(channelId, conn);
    }
  });

  if (createdSlugs.length > 0) {
    logger.info('Seed complete (added channels)', { created: createdSlugs });
  } else {
    logger.info('Seed complete (no new channels)');
  }

  if (updatedSlugs.length > 0) {
    logger.info('Seed complete (updated channels)', { updated: updatedSlugs });
  }
}
