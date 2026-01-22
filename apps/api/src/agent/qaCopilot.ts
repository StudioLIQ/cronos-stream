import axios from 'axios';
import { logger } from '../logger.js';

export interface QaCopilotResult {
  summary: string;
  answer: string;
  followUps: string[];
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
    .slice(0, 6);
}

function isOllamaEnabled(): boolean {
  return Boolean(process.env.OLLAMA_URL || process.env.OLLAMA_MODEL || process.env.OLLAMA_ASSIST_MODEL);
}

export async function getQaCopilotSuggestion(params: {
  message: string;
  displayName?: string | null;
  tier?: 'normal' | 'priority' | string;
  isMember?: boolean;
}): Promise<QaCopilotResult> {
  if (!isOllamaEnabled()) {
    throw new Error('Ollama is not configured (set OLLAMA_URL and pull a model)');
  }

  const message = normalizeText(params.message);
  if (!message) throw new Error('Missing message');
  if (message.length > 2000) throw new Error('Message too long');

  const baseUrl = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_ASSIST_MODEL || process.env.OLLAMA_MODEL || 'llama3.2:3b';
  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || '4000', 10);

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
              'You are a helpful copilot for a livestream host answering paid Q&A. ' +
              'Return JSON only with the exact shape: ' +
              '{"summary":string,"answer":string,"followUps":string[],"tags":string[]}. ' +
              'Be concise. Match the user language (Korean/English). ' +
              'If the question is unsafe/illegal, suggest a safe refusal and a safer alternative.',
          },
          {
            role: 'user',
            content:
              `Question:\n"""${message}"""\n\n` +
              `Context:\n- tier: ${params.tier || 'normal'}\n- isMember: ${params.isMember ? 'yes' : 'no'}\n- displayName: ${params.displayName || ''}\n`,
          },
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
    const summary = coerceString(obj.summary);
    const answer = coerceString(obj.answer);
    const followUps = coerceStringArray(obj.followUps);
    const tags = coerceStringArray(obj.tags);

    if (!summary || !answer) {
      throw new Error('Ollama returned invalid JSON schema');
    }

    return { summary, answer, followUps, tags, provider: 'ollama' };
  } catch (err) {
    logger.debug('Ollama copilot failed', { message: (err as Error).message });
    throw new Error('AI copilot unavailable (is Ollama running?)');
  }
}

