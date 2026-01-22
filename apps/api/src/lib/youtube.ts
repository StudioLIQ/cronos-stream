const YOUTUBE_CHANNEL_ID_RE = /^UC[a-zA-Z0-9_-]{20,}$/;
const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function parseUrlLoose(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    // Allow inputs like "youtube.com/watch?v=..." or "youtu.be/..."
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) {
      try {
        return new URL(`https://${input}`);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeYouTubeHost(hostname: string): 'youtube.com' | 'youtu.be' | 'youtube-nocookie.com' | null {
  const host = hostname.toLowerCase();
  if (host === 'youtu.be') return 'youtu.be';
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube.com';
  if (host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) return 'youtube-nocookie.com';
  return null;
}

export function toYouTubeEmbedUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // YouTube channel ID (preferred for "currently live" embeds)
  if (YOUTUBE_CHANNEL_ID_RE.test(trimmed)) {
    return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(trimmed)}`;
  }

  // YouTube video ID (11 chars)
  if (YOUTUBE_VIDEO_ID_RE.test(trimmed)) {
    return `https://www.youtube.com/embed/${encodeURIComponent(trimmed)}`;
  }

  const url = parseUrlLoose(trimmed);
  if (!url) return null;

  // Accept http(s); always output https.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = normalizeYouTubeHost(url.hostname);
  if (!host) return null;

  if (host === 'youtu.be') {
    const videoId = url.pathname.replace(/^\//, '').split('/')[0];
    if (!videoId || !YOUTUBE_VIDEO_ID_RE.test(videoId)) return null;
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  }

  if (host === 'youtube.com') {
    // Already an embed URL
    if (url.pathname.startsWith('/embed/')) {
      return `https://www.youtube.com${url.pathname}${url.search}`;
    }

    // /live_stream?channel=UC...
    if (url.pathname === '/live_stream') {
      const channelId = url.searchParams.get('channel');
      if (!channelId || !YOUTUBE_CHANNEL_ID_RE.test(channelId)) return null;
      return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channelId)}`;
    }

    // /watch?v=VIDEO_ID
    if (url.pathname === '/watch') {
      const videoId = url.searchParams.get('v');
      if (!videoId || !YOUTUBE_VIDEO_ID_RE.test(videoId)) return null;
      return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
    }

    // /live/VIDEO_ID
    if (url.pathname.startsWith('/live/')) {
      const videoId = url.pathname.split('/')[2];
      if (!videoId || !YOUTUBE_VIDEO_ID_RE.test(videoId)) return null;
      return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
    }

    // /shorts/VIDEO_ID
    if (url.pathname.startsWith('/shorts/')) {
      const videoId = url.pathname.split('/')[2];
      if (!videoId || !YOUTUBE_VIDEO_ID_RE.test(videoId)) return null;
      return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
    }

    // /channel/CHANNEL_ID
    if (url.pathname.startsWith('/channel/')) {
      const channelId = url.pathname.split('/')[2];
      if (!channelId || !YOUTUBE_CHANNEL_ID_RE.test(channelId)) return null;
      return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channelId)}`;
    }
  }

  if (host === 'youtube-nocookie.com') {
    if (url.pathname.startsWith('/embed/')) {
      return `https://www.youtube-nocookie.com${url.pathname}${url.search}`;
    }
  }

  return null;
}

