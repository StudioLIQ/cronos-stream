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
];

