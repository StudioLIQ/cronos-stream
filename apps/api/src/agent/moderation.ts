import axios from 'axios';
import { logger } from '../logger.js';

export type ModerationAction = 'allow' | 'reject' | 'block';

export interface ModerationResult {
  action: ModerationAction;
  reason?: string;
  tags: string[];
  provider: 'heuristic' | 'ollama';
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function moderateWithHeuristics(text: string): ModerationResult {
  const rules: Array<{
    tag: string;
    action: ModerationAction;
    reason: string;
    pattern: RegExp;
  }> = [
    {
      tag: 'pii_email',
      action: 'reject',
      reason: 'Message rejected by moderation agent (PII)',
      pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    },
    {
      tag: 'pii_phone',
      action: 'reject',
      reason: 'Message rejected by moderation agent (PII)',
      pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    },
    {
      tag: 'hate_speech',
      action: 'block',
      reason: 'Wallet blocked by moderation agent (hate speech)',
      pattern: /\b(?:nigger|faggot)\b/i,
    },
    {
      tag: 'abuse',
      action: 'reject',
      reason: 'Message rejected by moderation agent (abuse)',
      pattern: /\b(?:fuck|shit|ass|bitch)\b/i,
    },
    {
      tag: 'spam_links',
      action: 'reject',
      reason: 'Message rejected by moderation agent (spam)',
      pattern: /(https?:\/\/\S+\s*){2,}/i,
    },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      return {
        action: rule.action,
        reason: rule.reason,
        tags: [rule.tag],
        provider: 'heuristic',
      };
    }
  }

  return { action: 'allow', tags: [], provider: 'heuristic' };
}

function tryParseJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to extract the first JSON object from the text
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

async function moderateWithOllama(text: string): Promise<ModerationResult | null> {
  const enabled = process.env.MODERATION_PROVIDER === 'ollama' || process.env.OLLAMA_URL || process.env.OLLAMA_MODEL;
  if (!enabled) return null;

  const baseUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL || 'llama3.2:1b';
  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || '1500', 10);

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
              'You are a strict content-moderation agent for livestream chat. ' +
              'Return JSON only: {"action":"allow"|"reject"|"block","reason":string,"tags":string[]}. ' +
              'Use "block" only for hate speech, explicit threats, or repeated harassment.',
          },
          { role: 'user', content: `Message:\n"""${text}"""` },
        ],
      },
      { timeout: timeoutMs }
    );

    const content: unknown =
      response.data?.message?.content ??
      response.data?.response ??
      response.data?.output ??
      '';

    if (typeof content !== 'string' || !content.trim()) return null;

    const parsed = tryParseJsonObject(content);
    if (!parsed || typeof parsed !== 'object') return null;

    const obj = parsed as Record<string, unknown>;
    const action = obj.action;
    const reason = obj.reason;
    const tags = obj.tags;

    if (action !== 'allow' && action !== 'reject' && action !== 'block') return null;

    return {
      action,
      reason: typeof reason === 'string' ? reason : undefined,
      tags: Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [],
      provider: 'ollama',
    };
  } catch (err) {
    logger.debug('Ollama moderation failed; falling back to heuristics', {
      message: (err as Error).message,
    });
    return null;
  }
}

export async function moderateText(text: string): Promise<ModerationResult> {
  const normalized = normalizeText(text);
  if (!normalized) return { action: 'allow', tags: [], provider: 'heuristic' };

  const provider = process.env.MODERATION_PROVIDER || 'heuristic';
  if (provider === 'ollama') {
    const llm = await moderateWithOllama(normalized);
    if (llm) return llm;
  }

  return moderateWithHeuristics(normalized);
}

