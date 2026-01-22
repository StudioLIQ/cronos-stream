import axios from 'axios';

const YOUTUBE_CHANNEL_ID_RE = /^UC[a-zA-Z0-9_-]{20,}$/;
const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export type YouTubeChannelLiveResult =
  | { ok: true; isLive: true; videoId: string; checkedAt: string }
  | { ok: true; isLive: false; checkedAt: string; reason: 'not_live' | 'unavailable' }
  | { ok: false; checkedAt: string; error: string };

type CacheEntry = { result: YouTubeChannelLiveResult; expiresAt: number };
const liveCheckCache = new Map<string, CacheEntry>();

function nowIso(): string {
  return new Date().toISOString();
}

function getCached(channelId: string, nowMs: number): YouTubeChannelLiveResult | null {
  const entry = liveCheckCache.get(channelId);
  if (!entry) return null;
  if (entry.expiresAt <= nowMs) {
    liveCheckCache.delete(channelId);
    return null;
  }
  return entry.result;
}

function setCached(channelId: string, result: YouTubeChannelLiveResult, nowMs: number, ttlMs: number): void {
  liveCheckCache.set(channelId, { result, expiresAt: nowMs + ttlMs });
}

function parseYtPageType(html: string): string | null {
  const match = html.match(/window\['ytPageType'\]\s*=\s*\"([a-zA-Z]+)\"/);
  return match?.[1] ?? null;
}

function parseMainWatchVideoId(html: string): string | null {
  const match = html.match(/watchEndpoint\":\{\"videoId\":\"([a-zA-Z0-9_-]{11})\"/);
  const videoId = match?.[1] ?? null;
  if (!videoId || !YOUTUBE_VIDEO_ID_RE.test(videoId)) return null;
  return videoId;
}

function parseIsLiveContent(html: string): boolean {
  return html.includes('"isLiveContent":true') || html.includes('"liveBroadcastContent":"LIVE"');
}

export async function checkYouTubeChannelLive(
  channelId: string,
  opts?: { timeoutMs?: number; cacheTtlMs?: number }
): Promise<YouTubeChannelLiveResult> {
  const checkedAt = nowIso();
  const normalized = channelId.trim();
  if (!YOUTUBE_CHANNEL_ID_RE.test(normalized)) {
    return { ok: false, checkedAt, error: 'Invalid YouTube channel ID' };
  }

  const timeoutMs = opts?.timeoutMs ?? 8000;
  const cacheTtlMs = opts?.cacheTtlMs ?? 30_000;

  const nowMs = Date.now();
  const cached = getCached(normalized, nowMs);
  if (cached) return cached;

  try {
    const res = await axios.get<string>(`https://www.youtube.com/channel/${encodeURIComponent(normalized)}/live`, {
      timeout: timeoutMs,
      headers: {
        // Avoid bot/blocked responses; this doesn't need to be exact, just browser-like.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      responseType: 'text',
      validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300) {
      const result: YouTubeChannelLiveResult = { ok: true, isLive: false, checkedAt, reason: 'unavailable' };
      setCached(normalized, result, nowMs, cacheTtlMs);
      return result;
    }

    const html = res.data;
    const pageType = parseYtPageType(html);
    if (pageType !== 'watch') {
      const result: YouTubeChannelLiveResult = { ok: true, isLive: false, checkedAt, reason: 'not_live' };
      setCached(normalized, result, nowMs, cacheTtlMs);
      return result;
    }

    const isLiveContent = parseIsLiveContent(html);
    const videoId = parseMainWatchVideoId(html);

    if (!isLiveContent || !videoId) {
      const result: YouTubeChannelLiveResult = { ok: true, isLive: false, checkedAt, reason: 'not_live' };
      setCached(normalized, result, nowMs, cacheTtlMs);
      return result;
    }

    const result: YouTubeChannelLiveResult = { ok: true, isLive: true, videoId, checkedAt };
    setCached(normalized, result, nowMs, cacheTtlMs);
    return result;
  } catch (err) {
    const result: YouTubeChannelLiveResult = {
      ok: false,
      checkedAt,
      error: (err as Error).message || 'Failed to check YouTube live status',
    };
    // Cache errors briefly to avoid request storms during outages.
    setCached(normalized, result, nowMs, Math.min(cacheTtlMs, 10_000));
    return result;
  }
}
