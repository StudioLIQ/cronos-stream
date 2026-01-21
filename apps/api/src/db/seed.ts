import { v4 as uuid } from 'uuid';
import { queryOne, execute, transaction } from './db.js';
import { logger } from '../logger.js';

interface Channel {
  id: string;
  slug: string;
}

const SELLER_WALLET = process.env.SELLER_WALLET || '0x0000000000000000000000000000000000000000';
const DEFAULT_NETWORK = process.env.DEFAULT_NETWORK || 'cronos-testnet';

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

function toYouTubeEmbedUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // YouTube channel ID (preferred for "currently live" embeds)
  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
    return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(trimmed)}`;
  }

  // YouTube video ID (11 chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return `https://www.youtube.com/embed/${encodeURIComponent(trimmed)}`;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const videoId = url.pathname.replace(/^\//, '').split('/')[0];
    if (!videoId) return null;
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  }

  if (host === 'youtube.com') {
    if (url.pathname.startsWith('/embed/')) return url.toString();
    if (url.pathname === '/watch') {
      const videoId = url.searchParams.get('v');
      if (!videoId) return null;
      return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
    }
    if (url.pathname.startsWith('/live/')) {
      const videoId = url.pathname.split('/')[2];
      if (!videoId) return null;
      return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
    }
    if (url.pathname.startsWith('/channel/')) {
      const channelId = url.pathname.split('/')[2];
      if (!channelId) return null;
      return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channelId)}`;
    }
  }

  if (host === 'youtube-nocookie.com') {
    if (url.pathname.startsWith('/embed/')) return url.toString();
  }

  return null;
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
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=0OHUTcdWRLk'),
    },
    {
      slug: 'livenow-fox',
      displayName: 'LiveNOW from FOX',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=t6wqvEGW7xU'),
    },
    {
      slug: 'scripps-news',
      displayName: 'Scripps News',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=fMUoLkY1SxQ'),
    },
    {
      slug: 'fox-weather',
      displayName: 'FOX Weather',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=bIRkeTyn-9c'),
    },
    {
      slug: 'weather-channel',
      displayName: 'The Weather Channel',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=hTwKbl-s7MQ'),
    },
    {
      slug: 'nhk-world-japan',
      displayName: 'NHK WORLD-JAPAN',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=f0lYkdA-Gtw'),
    },
    {
      slug: 'kbs-world',
      displayName: 'KBS WORLD TV',
      streamEmbedUrl: toYouTubeEmbedUrl('https://www.youtube.com/watch?v=26WlVAcPk2w'),
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

  await transaction(async (conn) => {
    for (const ch of seedChannels) {
      const existing = await queryOne<Channel>('SELECT id, slug FROM channels WHERE slug = ?', [ch.slug], conn);

      const channelId = existing?.id || uuid();

      if (!existing) {
        await execute(
          `INSERT INTO channels (id, slug, displayName, payToAddress, network, streamEmbedUrl)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [channelId, ch.slug, ch.displayName, SELLER_WALLET, DEFAULT_NETWORK, ch.streamEmbedUrl],
          conn
        );
        createdSlugs.push(ch.slug);
      }

      await ensureDefaultActions(channelId, conn);
    }
  });

  if (createdSlugs.length > 0) {
    logger.info('Seed complete (added channels)', { created: createdSlugs });
  } else {
    logger.info('Seed complete (no new channels)');
  }
}
