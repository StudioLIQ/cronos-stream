export function toYouTubeEmbedUrl(input: string): string | null {
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

  // Convert common YouTube URLs to embed URLs.
  if (host === 'youtu.be') {
    const videoId = url.pathname.replace(/^\//, '').split('/')[0];
    if (!videoId) return null;
    return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
  }

  if (host === 'youtube.com') {
    // Already an embed URL
    if (url.pathname.startsWith('/embed/')) {
      return url.toString();
    }

    // /watch?v=VIDEO_ID
    if (url.pathname === '/watch') {
      const videoId = url.searchParams.get('v');
      if (!videoId) return null;
      return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
    }

    // /live/VIDEO_ID
    if (url.pathname.startsWith('/live/')) {
      const videoId = url.pathname.split('/')[2];
      if (!videoId) return null;
      return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
    }

    // /channel/CHANNEL_ID
    if (url.pathname.startsWith('/channel/')) {
      const channelId = url.pathname.split('/')[2];
      if (!channelId) return null;
      return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channelId)}`;
    }
  }

  if (host === 'youtube-nocookie.com') {
    if (url.pathname.startsWith('/embed/')) {
      return url.toString();
    }
  }

  return null;
}

export function extractYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // video id (11 chars)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0];
    return id || null;
  }

  if (host === 'youtube.com') {
    if (url.pathname === '/watch') return url.searchParams.get('v');
    if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2] || null;
    if (url.pathname.startsWith('/live/')) return url.pathname.split('/')[2] || null;
  }

  if (host === 'youtube-nocookie.com') {
    if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2] || null;
  }

  return null;
}

export function youtubeThumbnailUrl(input: string): string | null {
  const videoId = extractYouTubeVideoId(input);
  if (!videoId) return null;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

