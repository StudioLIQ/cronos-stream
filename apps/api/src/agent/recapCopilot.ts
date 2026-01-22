import axios from 'axios';
import { logger } from '../logger.js';

export interface StreamRecapStats {
  from: string;
  to: string;
  totalRevenueBaseUnits: string;
  supportCount: number;
  uniqueSupporters: number;
  kindCounts: Record<string, number>;
  kindTotalsBaseUnits: Record<string, string>;
  newMembers: number;
}

export interface StreamRecapTopSupporter {
  displayName: string | null;
  fromAddress: string;
  totalBaseUnits: string;
  supportCount: number;
}

export interface StreamRecapEffectSummary {
  actionKey: string;
  count: number;
}

export interface StreamRecapQaHighlight {
  displayName: string | null;
  tier: string;
  status: string;
  message: string;
}

export interface StreamRecapNewMember {
  displayName: string | null;
  fromAddress: string;
}

export interface StreamRecapResult {
  title: string;
  markdown: string;
  tweet: string;
  tags: string[];
  provider: 'ollama';
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function tryParseJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const slice = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      return null;
    }
  }
}

function coerceString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function shortenAddress(addr: string): string {
  const a = addr.toLowerCase();
  if (!a.startsWith('0x') || a.length < 10) return addr;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function formatUsdc(baseUnits: string): string {
  try {
    const n = BigInt(baseUnits);
    const whole = n / 1_000_000n;
    const frac = n % 1_000_000n;
    const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
    return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
  } catch {
    return baseUnits;
  }
}

function isOllamaEnabled(): boolean {
  return Boolean(process.env.OLLAMA_URL || process.env.OLLAMA_MODEL || process.env.OLLAMA_RECAP_MODEL || process.env.OLLAMA_ASSIST_MODEL);
}

function detectPrimaryLanguage(samples: string[]): 'ko' | 'en' {
  const joined = samples.join('\n');
  const hangul = (joined.match(/[가-힣]/g) || []).length;
  const latin = (joined.match(/[a-zA-Z]/g) || []).length;
  return hangul >= latin ? 'ko' : 'en';
}

export async function generateStreamRecap(params: {
  channelDisplayName: string;
  channelSlug: string;
  stats: StreamRecapStats;
  topSupporters: StreamRecapTopSupporter[];
  topEffects: StreamRecapEffectSummary[];
  qaHighlights: StreamRecapQaHighlight[];
  newMembers: StreamRecapNewMember[];
}): Promise<StreamRecapResult> {
  if (!isOllamaEnabled()) {
    throw new Error('Ollama is not configured (set OLLAMA_URL and pull a model)');
  }

  const baseUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model =
    process.env.OLLAMA_RECAP_MODEL ||
    process.env.OLLAMA_ASSIST_MODEL ||
    process.env.OLLAMA_MODEL ||
    'llama3.2:3b';
  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || '6000', 10);

  const lang = detectPrimaryLanguage([
    params.channelDisplayName,
    ...params.qaHighlights.map((q) => q.message),
  ]);

  const supporterLines = params.topSupporters.map((s, idx) => {
    const name = s.displayName || shortenAddress(s.fromAddress);
    return `${idx + 1}. ${name} — $${formatUsdc(s.totalBaseUnits)} (${s.supportCount} tx)`;
  });

  const memberLines = params.newMembers.map((m, idx) => {
    const name = m.displayName || shortenAddress(m.fromAddress);
    return `${idx + 1}. ${name}`;
  });

  const effectLines = params.topEffects.map((e, idx) => `${idx + 1}. ${e.actionKey} (${e.count})`);

  const qaLines = params.qaHighlights.map((q, idx) => {
    const name = q.displayName || 'anon';
    const msg = normalizeText(q.message).slice(0, 240);
    return `${idx + 1}. [${q.tier}/${q.status}] ${name}: ${msg}`;
  });

  const stats = params.stats;
  const kindCounts = stats.kindCounts || {};
  const kindTotals = stats.kindTotalsBaseUnits || {};

  const prompt = [
    `Channel: ${params.channelDisplayName} (@${params.channelSlug})`,
    `Window: ${stats.from} → ${stats.to}`,
    '',
    'Stats (USDC base units are 6-decimals):',
    `- totalRevenue: $${formatUsdc(stats.totalRevenueBaseUnits)} USDC`,
    `- supportCount: ${stats.supportCount}`,
    `- uniqueSupporters: ${stats.uniqueSupporters}`,
    `- newMembers: ${stats.newMembers}`,
    `- countsByKind: ${JSON.stringify(kindCounts)}`,
    `- totalsByKindUsd: ${JSON.stringify(
      Object.fromEntries(Object.entries(kindTotals).map(([k, v]) => [k, formatUsdc(v)]))
    )}`,
    '',
    'Top Supporters:',
    supporterLines.length > 0 ? supporterLines.join('\n') : '(none)',
    '',
    'New Members (latest):',
    memberLines.length > 0 ? memberLines.join('\n') : '(none)',
    '',
    'Top Effects:',
    effectLines.length > 0 ? effectLines.join('\n') : '(none)',
    '',
    'Q&A Highlights:',
    qaLines.length > 0 ? qaLines.join('\n') : '(none)',
  ].join('\n');

  try {
    const response = await axios.post(
      `${baseUrl}/api/chat`,
      {
        model,
        stream: false,
        format: 'json',
        messages: [
          {
            role: 'system',
            content:
              'You generate a post-stream recap for a livestream creator based on provided data. ' +
              'Return JSON only with exact shape: {"title":string,"markdown":string,"tweet":string,"tags":string[]}. ' +
              'Do NOT include any full wallet addresses in the output. Use display names if present; otherwise use short 0x1234…abcd style. ' +
              'Keep markdown readable (headings + bullets). Keep tweet <= 280 chars. ' +
              `Write in ${lang === 'ko' ? 'Korean' : 'English'} unless the content clearly suggests the other.`,
          },
          { role: 'user', content: prompt },
        ],
      },
      { timeout: timeoutMs }
    );

    const content: unknown =
      response.data?.message?.content ??
      response.data?.response ??
      response.data?.output ??
      '';

    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Ollama returned empty response');
    }

    const parsed = tryParseJsonObject(content);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Ollama returned non-JSON response');
    }

    const obj = parsed as Record<string, unknown>;
    const title = coerceString(obj.title);
    const markdown = coerceString(obj.markdown);
    const tweet = coerceString(obj.tweet);
    const tags = coerceStringArray(obj.tags);

    if (!title || !markdown || !tweet) {
      throw new Error('Ollama returned invalid JSON schema');
    }

    return { title, markdown, tweet, tags, provider: 'ollama' };
  } catch (err) {
    logger.debug('Ollama recap failed', { message: (err as Error).message });
    throw new Error('AI recap unavailable (is Ollama running?)');
  }
}

