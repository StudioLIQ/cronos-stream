import { toYouTubeEmbedUrl } from '../lib/youtube.js';

export type SeedChannel = {
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

export function buildSeedChannels(): SeedChannel[] {
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

