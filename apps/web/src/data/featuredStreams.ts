export type FeaturedStream = {
  /**
   * Unique id for the curated list (not the channel slug).
   */
  id: string;
  /**
   * Stream402 channel slug (used for API calls like donations/effects/Q&A).
   */
  slug: string;
  title: string;
  creatorName: string;
  /**
   * For now we only support YouTube. This can be:
   * - a YouTube watch URL (recommended)
   * - a YouTube channel ID (UC...)
   * - an embed URL
   */
  youtube: {
    url: string;
  };
  category?: string;
  tags?: string[];
  thumbnailUrl?: string;
};

export const FEATURED_STREAMS: FeaturedStream[] = [
  {
    id: 'demo',
    slug: 'demo',
    title: 'Demo Stream',
    creatorName: 'Demo Channel',
    youtube: { url: 'https://www.youtube.com/watch?v=Ap-UM1O9RBU' },
    category: 'Demo',
    tags: ['demo'],
  },
  {
    id: 'lofi-girl',
    slug: 'lofi-girl',
    title: 'lofi hip hop radio — beats to relax/study to',
    creatorName: 'Lofi Girl',
    youtube: { url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' },
    category: 'Music',
    tags: ['lofi', 'study', 'beats'],
  },
  {
    id: 'lofi-girl-synthwave',
    slug: 'lofi-girl-synthwave',
    title: 'synthwave radio — beats to chill/game to',
    creatorName: 'Lofi Girl',
    youtube: { url: 'https://www.youtube.com/watch?v=4xDzrJKXOOY' },
    category: 'Music',
    tags: ['synthwave', 'chill', 'beats'],
  },
  {
    id: 'chillhop-radio',
    slug: 'chillhop-radio',
    title: 'Chillhop Radio — jazz & lofi beats',
    creatorName: 'Chillhop Music',
    youtube: { url: 'https://www.youtube.com/watch?v=5yx6BWlEVcY' },
    category: 'Music',
    tags: ['lofi', 'jazz', 'beats'],
  },
  {
    id: 'jazz-piano-radio',
    slug: 'jazz-piano-radio',
    title: 'Jazz piano radio — cafe vibes',
    creatorName: 'Cafe Music BGM channel',
    youtube: { url: 'https://www.youtube.com/watch?v=Dx5qFachd3A' },
    category: 'Music',
    tags: ['jazz', 'piano', 'cafe'],
  },
  {
    id: 'white-noise',
    slug: 'white-noise',
    title: 'Rain & white noise — sleep / focus',
    creatorName: 'Rain on The Park',
    youtube: { url: 'https://www.youtube.com/watch?v=uGMRuZe8qrw' },
    category: 'Ambient',
    tags: ['rain', 'white-noise', 'sleep', 'focus'],
  },
  {
    id: 'aljazeera-english',
    slug: 'aljazeera-english',
    title: 'Al Jazeera English — Live',
    creatorName: 'Al Jazeera English',
    youtube: { url: 'https://www.youtube.com/watch?v=gCNeDWCI0vo' },
    category: 'News',
    tags: ['news', 'live'],
  },
  {
    id: 'sky-news',
    slug: 'sky-news',
    title: 'Sky News — Live',
    creatorName: 'Sky News',
    youtube: { url: 'https://www.youtube.com/watch?v=UFwBCAZuvTg' },
    category: 'News',
    tags: ['news', 'live'],
  },
  {
    id: 'dw-news',
    slug: 'dw-news',
    title: 'DW News — Live',
    creatorName: 'DW News',
    youtube: { url: 'https://www.youtube.com/watch?v=LuKwFajn37U' },
    category: 'News',
    tags: ['news', 'live'],
  },
  {
    id: 'euronews-english',
    slug: 'euronews-english',
    title: 'euronews — Live',
    creatorName: 'euronews',
    youtube: { url: 'https://www.youtube.com/watch?v=pykpO5kQJ98' },
    category: 'News',
    tags: ['news', 'live'],
  },
  {
    id: 'france24-fr',
    slug: 'france24-fr',
    title: 'FRANCE 24 — En direct',
    creatorName: 'FRANCE 24',
    youtube: { url: 'https://www.youtube.com/watch?v=l8PMl7tUDIE' },
    category: 'News',
    tags: ['news', 'live'],
  },
  {
    id: 'abc-news-live',
    slug: 'abc-news-live',
    title: 'ABC News Live',
    creatorName: 'ABC News',
    youtube: { url: 'https://www.youtube.com/watch?v=iipR5yUp36o' },
    category: 'News',
    tags: ['news', 'live'],
  },
  {
    id: 'bloomberg-live',
    slug: 'bloomberg-live',
    title: 'Bloomberg Television — Live',
    creatorName: 'Bloomberg Television',
    youtube: { url: 'https://www.youtube.com/watch?v=iEpJwprxDdk' },
    category: 'News',
    tags: ['markets', 'business', 'news', 'live'],
  },
  {
    id: 'nbc-news-now',
    slug: 'nbc-news-now',
    title: 'NBC News NOW — Live',
    creatorName: 'NBC News',
    youtube: { url: 'https://www.youtube.com/watch?v=0OHUTcdWRLk' },
    category: 'News',
    tags: ['news', 'live', 'us'],
  },
  {
    id: 'livenow-fox',
    slug: 'livenow-fox',
    title: 'LiveNOW from FOX — Live',
    creatorName: 'LiveNOW from FOX',
    youtube: { url: 'https://www.youtube.com/watch?v=t6wqvEGW7xU' },
    category: 'News',
    tags: ['news', 'live', 'us'],
  },
  {
    id: 'scripps-news',
    slug: 'scripps-news',
    title: 'Scripps News — Live',
    creatorName: 'Scripps News',
    youtube: { url: 'https://www.youtube.com/watch?v=fMUoLkY1SxQ' },
    category: 'News',
    tags: ['news', 'live', 'us'],
  },
  {
    id: 'fox-weather',
    slug: 'fox-weather',
    title: 'FOX Weather — Live',
    creatorName: 'FOX Weather',
    youtube: { url: 'https://www.youtube.com/watch?v=bIRkeTyn-9c' },
    category: 'Weather',
    tags: ['weather', 'live'],
  },
  {
    id: 'weather-channel',
    slug: 'weather-channel',
    title: 'The Weather Channel — Live',
    creatorName: 'The Weather Channel',
    youtube: { url: 'https://www.youtube.com/watch?v=hTwKbl-s7MQ' },
    category: 'Weather',
    tags: ['weather', 'live'],
  },
  {
    id: 'nhk-world-japan',
    slug: 'nhk-world-japan',
    title: 'NHK WORLD-JAPAN — Live',
    creatorName: 'NHK WORLD-JAPAN',
    youtube: { url: 'https://www.youtube.com/watch?v=f0lYkdA-Gtw' },
    category: 'Japan',
    tags: ['japan', 'news', 'live'],
  },
  {
    id: 'kbs-world',
    slug: 'kbs-world',
    title: 'KBS WORLD TV — Live',
    creatorName: 'KBS WORLD TV',
    youtube: { url: 'https://www.youtube.com/watch?v=26WlVAcPk2w' },
    category: 'Korea',
    tags: ['korea', 'news', 'live'],
  },
  {
    id: 'arirang-tv',
    slug: 'arirang-tv',
    title: 'Arirang TV — Live',
    creatorName: 'Arirang TV',
    youtube: { url: 'https://www.youtube.com/watch?v=CJVBX7KI5nU' },
    category: 'Korea',
    tags: ['korea', 'news', 'live'],
  },
  {
    id: 'ytn',
    slug: 'ytn',
    title: 'YTN — Live',
    creatorName: 'YTN',
    youtube: { url: 'https://www.youtube.com/watch?v=FJfwehhzIhw' },
    category: 'Korea',
    tags: ['korea', 'news', 'live'],
  },
  {
    id: 'yonhapnews-tv',
    slug: 'yonhapnews-tv',
    title: 'YonhapnewsTV — Live',
    creatorName: 'YonhapnewsTV',
    youtube: { url: 'https://www.youtube.com/watch?v=6QZ_qc75ihU' },
    category: 'Korea',
    tags: ['korea', 'news', 'live'],
  },
  {
    id: 'times-square',
    slug: 'times-square',
    title: 'Times Square — live cam',
    creatorName: 'EarthCam',
    youtube: { url: 'https://www.youtube.com/watch?v=rnXIjl_Rzy4' },
    category: 'City Cam',
    tags: ['city', 'cam', 'nyc'],
  },
  {
    id: 'iss-live',
    slug: 'iss-live',
    title: 'ISS Live — Earth from space',
    creatorName: 'afarTV',
    youtube: { url: 'https://www.youtube.com/watch?v=vytmBNhc9ig' },
    category: 'Space',
    tags: ['space', 'iss', 'earth'],
  },
  {
    id: 'decorah-eagles',
    slug: 'decorah-eagles',
    title: 'Decorah Eagles — live cam',
    creatorName: 'Explore Birds Bats Bees',
    youtube: { url: 'https://www.youtube.com/watch?v=IVmL3diwJuw' },
    category: 'Wildlife',
    tags: ['wildlife', 'birds', 'cam'],
  },
  {
    id: 'anan-wildlife-falls',
    slug: 'anan-wildlife-falls',
    title: 'Anan Wildlife Falls — live bear cam',
    creatorName: 'Explore Bears & Bison',
    youtube: { url: 'https://www.youtube.com/watch?v=2360fnKZcIQ' },
    category: 'Wildlife',
    tags: ['wildlife', 'bears', 'cam'],
  },
];

export function getFeaturedStreamBySlug(slug: string): FeaturedStream | undefined {
  return FEATURED_STREAMS.find((s) => s.slug === slug);
}
