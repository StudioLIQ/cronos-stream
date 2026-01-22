import { v4 as uuid } from 'uuid';
import { queryOne, execute, transaction } from './db.js';
import { logger } from '../logger.js';
import { toYouTubeEmbedUrl } from '../lib/youtube.js';

interface Channel {
  id: string;
  slug: string;
}

const SELLER_WALLET = process.env.SELLER_WALLET || '0x0000000000000000000000000000000000000000';
const DEFAULT_NETWORK = process.env.DEFAULT_NETWORK || 'cronos-testnet';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type SeedChannel = {
  slug: string;
  displayName: string;
  streamEmbedUrl: string | null;
};

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

function buildSeedChannels(): SeedChannel[] {
  return [
    {
      slug: 'demo',
      displayName: 'Demo Channel',
      streamEmbedUrl: buildDemoStreamEmbedUrl(),
    },
    {
      slug: 'lofi-girl',
      displayName: 'Lofi Girl',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=jfKfPfyJRdk'),
    },
    {
      slug: 'lofi-girl-synthwave',
      displayName: 'Lofi Girl',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=4xDzrJKXOOY'),
    },
    {
      slug: 'chillhop-radio',
      displayName: 'Chillhop Music',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=5yx6BWlEVcY'),
    },
    {
      slug: 'aljazeera-english',
      displayName: 'Al Jazeera English',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=gCNeDWCI0vo'),
    },
    {
      slug: 'sky-news',
      displayName: 'Sky News',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=UFwBCAZuvTg'),
    },
    {
      slug: 'dw-news',
      displayName: 'DW News',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=LuKwFajn37U'),
    },
    {
      slug: 'euronews-english',
      displayName: 'euronews',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=pykpO5kQJ98'),
    },
    {
      slug: 'france24-fr',
      displayName: 'FRANCE 24',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=l8PMl7tUDIE'),
    },
    {
      slug: 'abc-news-live',
      displayName: 'ABC News',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=iipR5yUp36o'),
    },
    {
      slug: 'bloomberg-live',
      displayName: 'Bloomberg Television',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=iEpJwprxDdk'),
    },
    {
      slug: 'nbc-news-now',
      displayName: 'NBC News',
      // Use channel ID for a stable "currently live" embed. Individual NBC News live video IDs rotate frequently.
      streamEmbedUrl: toYouTubeEmbedUrl('UCeY0bbntWzzVIaj2z3QigXg'),
    },
    {
      slug: 'livenow-fox',
      displayName: 'LiveNOW from FOX',
      // Use channel ID for a stable "currently live" embed. Individual LiveNOW live video IDs rotate frequently.
      streamEmbedUrl: toYouTubeEmbedUrl('UCJg9wBPyKMNA5sRDnvzmkdg'),
    },
    {
      slug: 'scripps-news',
      displayName: 'Scripps News',
      // Use channel ID for a stable "currently live" embed. Individual Scripps News live video IDs rotate frequently.
      streamEmbedUrl: toYouTubeEmbedUrl('UCTln5ss6h6L_xNfMeujfPbg'),
    },
    {
      slug: 'fox-weather',
      displayName: 'FOX Weather',
      // Use channel ID for a stable "currently live" embed. Individual FOX Weather live video IDs rotate frequently.
      streamEmbedUrl: toYouTubeEmbedUrl('UC1FbPiXx59_ltnFVx7IxWow'),
    },
    {
      slug: 'weather-channel',
      displayName: 'The Weather Channel',
      // Use channel ID for a stable "currently live" embed.
      streamEmbedUrl: toYouTubeEmbedUrl('UCGTUbwceCMibvpbd2NaIP7A'),
    },
    {
      slug: 'nhk-world-japan',
      displayName: 'NHK WORLD-JAPAN',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=f0lYkdA-Gtw'),
    },
    {
      slug: 'kbs-world',
      displayName: 'KBS WORLD TV',
      // Use channel ID for a stable "currently live" embed. Individual KBS WORLD live video IDs rotate frequently.
      streamEmbedUrl: toYouTubeEmbedUrl('UC5BMQOsAB8hKUyHu9KI6yig'),
    },
    {
      slug: 'arirang-tv',
      displayName: 'Arirang TV',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=CJVBX7KI5nU'),
    },
    {
      slug: 'ytn',
      displayName: 'YTN',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=FJfwehhzIhw'),
    },
    {
      slug: 'yonhapnews-tv',
      displayName: 'YonhapnewsTV',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=6QZ_qc75ihU'),
    },
    {
      slug: 'decorah-eagles',
      displayName: 'Explore Birds Bats Bees',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=IVmL3diwJuw'),
    },
    {
      slug: 'anan-wildlife-falls',
      displayName: 'Explore Bears & Bison',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=2360fnKZcIQ'),
    },
    {
      slug: 'times-square',
      displayName: 'EarthCam',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=rnXIjl_Rzy4'),
    },
    {
      slug: 'iss-live',
      displayName: 'afarTV',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=vytmBNhc9ig'),
    },
    {
      slug: 'jazz-piano-radio',
      displayName: 'Cafe Music BGM channel',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=Dx5qFachd3A'),
    },
    {
      slug: 'white-noise',
      displayName: 'Rain on The Park',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=uGMRuZe8qrw'),
    },
  ];
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
          [channelId, ch.slug, ch.displayName, SELLER_WALLET, DEFAULT_NETWORK, ch.streamEmbedUrl],
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

      // Backfill payToAddress if it was seeded with the zero address and is now configured.
      if (
        existing &&
        existing.payToAddress?.toLowerCase() === ZERO_ADDRESS &&
        SELLER_WALLET.toLowerCase() !== ZERO_ADDRESS
      ) {
        await execute('UPDATE channels SET payToAddress = ?, network = ? WHERE id = ?', [SELLER_WALLET, DEFAULT_NETWORK, channelId], conn);
        updatedSlugs.push(ch.slug);
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
