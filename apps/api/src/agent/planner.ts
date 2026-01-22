export type AgentStep =
  | {
      kind: 'effect';
      actionKey: string;
    }
  | {
      kind: 'donation';
      amountBaseUnits: string;
      message: string | null;
      displayName: string | null;
    }
  | {
      kind: 'qa';
      message: string;
      tier: 'normal' | 'priority';
      displayName: string | null;
    }
  | {
      kind: 'membership';
      planId: string;
    };

export interface AgentPlan {
  steps: AgentStep[];
  summary: string;
  warnings: string[];
}

export interface PlannerAction {
  actionKey: string;
  type: string;
}

export interface PlannerMembershipPlan {
  id: string;
  name: string;
}

function normalizeInput(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findAllMatches(input: string, pattern: RegExp): Array<{ index: number; match: string }> {
  const results: Array<{ index: number; match: string }> = [];
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(input))) {
    if (typeof m.index === 'number' && m[0]) {
      results.push({ index: m.index, match: m[0] });
    }
    // Avoid infinite loops with zero-length matches
    if (m && m[0].length === 0) re.lastIndex += 1;
  }
  return results;
}

function parseUsdcToBaseUnits(amount: string): { ok: true; baseUnits: string } | { ok: false; error: string } {
  let normalized = amount.trim();
  if (!normalized) return { ok: false, error: 'Missing amount' };

  normalized = normalized.replace(/,/g, '');
  normalized = normalized.replace(/\$/g, '');
  normalized = normalized.replace(/usdc(?:\.e)?/gi, '');
  normalized = normalized.replace(/cro/gi, '');
  normalized = normalized.trim();

  if (!normalized) return { ok: false, error: 'Missing amount' };
  if (normalized.startsWith('.')) normalized = `0${normalized}`;
  if (normalized.endsWith('.')) normalized = normalized.slice(0, -1);

  if (!/^\d+(\.\d{0,6})?$/.test(normalized)) {
    return { ok: false, error: 'Invalid amount format' };
  }

  const [wholePart, fractionalPart = ''] = normalized.split('.');
  const whole = BigInt(wholePart || '0');
  const fractionalPadded = fractionalPart.padEnd(6, '0');
  const fractional = BigInt(fractionalPadded || '0');

  const baseUnits = (whole * 1_000_000n + fractional).toString();
  if (BigInt(baseUnits) <= 0n) return { ok: false, error: 'Amount must be > 0' };

  return { ok: true, baseUnits };
}

function extractFirstQuotedText(after: string): string | null {
  const quoteMatch = after.match(/["“”'‘’](.+?)["“”'‘’]/);
  if (!quoteMatch) return null;
  const text = quoteMatch[1]?.trim();
  return text ? text : null;
}

function pickFirst<T>(items: T[]): T | null {
  return items.length > 0 ? items[0] : null;
}

function pickEffectActionKey(params: {
  inputLower: string;
  actions: PlannerAction[];
  desiredType?: 'sticker' | 'flash' | 'sound';
}): string | null {
  const { inputLower, actions, desiredType } = params;

  // 1) Exact actionKey mention wins
  for (const action of actions) {
    if (inputLower.includes(action.actionKey.toLowerCase())) return action.actionKey;
  }

  // 2) Type-based pick
  if (desiredType) {
    const match = actions.find((a) => a.type === desiredType);
    if (match) return match.actionKey;
  }

  // 3) Heuristic by keywords
  const wantsSound = /\b(airhorn|horn|sound)\b|사운드|에어혼/.test(inputLower);
  const wantsFlash = /\b(flash|blink)\b|번쩍|플래시/.test(inputLower);
  const wantsSticker = /\b(sticker|emoji|emote)\b|스티커|이모지/.test(inputLower);

  if (wantsSound) {
    const match = actions.find((a) => a.type === 'sound');
    if (match) return match.actionKey;
  }
  if (wantsFlash) {
    const match = actions.find((a) => a.type === 'flash');
    if (match) return match.actionKey;
  }
  if (wantsSticker) {
    const match = actions.find((a) => a.type === 'sticker');
    if (match) return match.actionKey;
  }

  // 4) Fallback: first enabled action
  const first = pickFirst(actions);
  return first ? first.actionKey : null;
}

function determineQaTier(inputLower: string): 'normal' | 'priority' {
  if (/\b(priority|prio|urgent)\b|우선|긴급|프리미엄/.test(inputLower)) return 'priority';
  return 'normal';
}

function buildSummary(steps: AgentStep[]): string {
  if (steps.length === 0) return 'No steps';
  const parts = steps.map((s) => {
    switch (s.kind) {
      case 'effect':
        return `effect(${s.actionKey})`;
      case 'donation':
        return `donation(${s.amountBaseUnits})`;
      case 'qa':
        return `qa(${s.tier})`;
      case 'membership':
        return 'membership';
    }
  });
  return parts.join(' → ');
}

export function planAgent(params: {
  input: string;
  actions: PlannerAction[];
  membershipPlans: PlannerMembershipPlan[];
  maxSteps?: number;
}): { ok: true; plan: AgentPlan } | { ok: false; error: string } {
  const warnings: string[] = [];
  const maxSteps = Math.max(1, Math.min(params.maxSteps ?? 5, 10));

  const normalized = normalizeInput(params.input);
  if (!normalized) return { ok: false, error: 'Empty input' };

  const inputLower = normalized.toLowerCase();

  type Occurrence =
    | { kind: 'donation'; index: number; match: string }
    | { kind: 'qa'; index: number; match: string }
    | { kind: 'membership'; index: number; match: string }
    | { kind: 'effect'; index: number; match: string; desiredType?: 'sticker' | 'flash' | 'sound'; actionKey?: string };

  const occurrences: Occurrence[] = [];

  // Donation mentions
  const donationMatches = findAllMatches(normalized, /\b(donate|donation|tip|support|send)\b|후원|도네|기부/gi);
  for (const m of donationMatches) occurrences.push({ kind: 'donation', index: m.index, match: m.match });

  // Q&A mentions
  const qaMatches = findAllMatches(normalized, /\b(q&a|qa|question|ask)\b|질문/gi);
  for (const m of qaMatches) occurrences.push({ kind: 'qa', index: m.index, match: m.match });

  // Membership mentions
  const membershipMatches = findAllMatches(
    normalized,
    /\b(membership|member|subscribe|sub)\b|멤버십|멤버|구독/gi
  );
  for (const m of membershipMatches) occurrences.push({ kind: 'membership', index: m.index, match: m.match });

  // Effect mentions: explicit actionKey
  for (const action of params.actions) {
    const keyLower = action.actionKey.toLowerCase();
    let fromIndex = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const idx = inputLower.indexOf(keyLower, fromIndex);
      if (idx === -1) break;
      occurrences.push({ kind: 'effect', index: idx, match: action.actionKey, actionKey: action.actionKey });
      fromIndex = idx + keyLower.length;
    }
  }

  // Effect mentions: type keywords
  const stickerMatches = findAllMatches(normalized, /\b(sticker|emoji|emote)\b|스티커|이모지/gi);
  for (const m of stickerMatches) occurrences.push({ kind: 'effect', index: m.index, match: m.match, desiredType: 'sticker' });

  const flashMatches = findAllMatches(normalized, /\b(flash|blink)\b|번쩍|플래시/gi);
  for (const m of flashMatches) occurrences.push({ kind: 'effect', index: m.index, match: m.match, desiredType: 'flash' });

  const soundMatches = findAllMatches(normalized, /\b(airhorn|horn|sound)\b|사운드|에어혼/gi);
  for (const m of soundMatches) occurrences.push({ kind: 'effect', index: m.index, match: m.match, desiredType: 'sound' });

  // If nothing matched, treat as a QA message by default (lowest-friction agent behavior)
  if (occurrences.length === 0) {
    return {
      ok: true,
      plan: {
        steps: [
          {
            kind: 'qa',
            message: normalized,
            tier: determineQaTier(inputLower),
            displayName: null,
          },
        ],
        summary: 'qa',
        warnings: ['No intent keywords found; defaulted to Q&A'],
      },
    };
  }

  occurrences.sort((a, b) => a.index - b.index);

  const steps: AgentStep[] = [];
  const dedupe = new Set<string>();

  for (const occ of occurrences) {
    if (steps.length >= maxSteps) break;

    if (occ.kind === 'effect') {
      const actionKey =
        occ.actionKey ||
        pickEffectActionKey({ inputLower, actions: params.actions, desiredType: occ.desiredType });
      if (!actionKey) continue;
      const sig = `effect:${actionKey}`;
      if (dedupe.has(sig)) continue;
      dedupe.add(sig);
      steps.push({ kind: 'effect', actionKey });
      continue;
    }

    if (occ.kind === 'donation') {
      // Prefer amount close to the keyword
      const after = normalized.slice(occ.index + occ.match.length, occ.index + occ.match.length + 60);
      const amountMatch = after.match(/(\d+(?:\.\d{1,6})?)/);
      const amountStr = amountMatch?.[1] || '';
      let baseUnits = '50000'; // default: $0.05
      if (amountStr) {
        const parsed = parseUsdcToBaseUnits(amountStr);
        if (parsed.ok) {
          baseUnits = parsed.baseUnits;
        } else {
          warnings.push(`Could not parse donation amount "${amountStr}", defaulted to 0.05`);
        }
      } else {
        warnings.push('No donation amount found, defaulted to 0.05');
      }

      const quoted = extractFirstQuotedText(after);
      const sig = `donation:${baseUnits}:${quoted || ''}`;
      if (dedupe.has(sig)) continue;
      dedupe.add(sig);
      steps.push({ kind: 'donation', amountBaseUnits: baseUnits, message: quoted, displayName: null });
      continue;
    }

    if (occ.kind === 'qa') {
      const after = normalized.slice(occ.index + occ.match.length).trim();
      const quoted = extractFirstQuotedText(after);
      const message = (quoted || after.replace(/^[:\-–—]\s*/, '').trim()).trim();
      if (!message) continue;

      const tier = determineQaTier(inputLower);
      const sig = `qa:${tier}:${message}`;
      if (dedupe.has(sig)) continue;
      dedupe.add(sig);
      steps.push({ kind: 'qa', message, tier, displayName: null });
      continue;
    }

    if (occ.kind === 'membership') {
      if (params.membershipPlans.length === 0) continue;

      const matchByName = params.membershipPlans.find((p) => inputLower.includes(p.name.toLowerCase()));
      const planId = (matchByName || params.membershipPlans[0])!.id;
      const sig = `membership:${planId}`;
      if (dedupe.has(sig)) continue;
      dedupe.add(sig);
      steps.push({ kind: 'membership', planId });
      continue;
    }
  }

  if (steps.length === 0) {
    return { ok: false, error: 'Could not build a plan from input' };
  }

  return {
    ok: true,
    plan: {
      steps,
      summary: buildSummary(steps),
      warnings,
    },
  };
}

