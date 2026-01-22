import { API_BASE } from './config';

export interface Channel {
  slug: string;
  displayName: string;
  payToAddress: string;
  network: string;
  streamEmbedUrl?: string | null;
}

export type StreamStatusResponse =
  | { ok: true; status: 'unconfigured'; checkedAt: string }
  | {
      ok: true;
      status: 'live';
      platform: 'youtube';
      checkedAt: string;
      videoId: string;
      embedUrl: string;
    }
  | { ok: true; status: 'offline'; platform: 'youtube'; checkedAt: string; reason: string }
  | { ok: true; status: 'unknown'; checkedAt: string }
  | { ok: false; checkedAt: string; error: string };

export interface Action {
  actionKey: string;
  type: 'sticker' | 'sound' | 'flash';
  priceBaseUnits: string;
  payload: Record<string, unknown>;
}

export interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  payTo: string;
  asset: string;
  description: string;
  mimeType: string;
  maxAmountRequired: string;
  maxTimeoutSeconds: number;
}

export interface PaymentResponse {
  ok: true;
  payment: {
    paymentId: string;
    txHash: string;
    from: string;
    to: string;
    value: string;
    blockNumber?: number;
  };
  qaId?: string;
  cached?: boolean;
}

export interface Error402Response {
  error: string;
  x402Version: 1;
  paymentRequirements: PaymentRequirements;
}

export interface UpdateChannelResponse {
  ok: true;
  streamEmbedUrl: string | null;
}

function extractErrorMessage(data: unknown, fallback: string): string {
  const obj = data as Record<string, unknown> | null;
  const error = obj && typeof obj.error === 'string' ? obj.error : fallback;
  const reason = obj && typeof obj.reason === 'string' ? obj.reason : null;
  return reason ? `${error}: ${reason}` : error;
}

export type AgentStep =
  | { kind: 'effect'; actionKey: string }
  | { kind: 'donation'; amountBaseUnits: string; message: string | null; displayName: string | null }
  | { kind: 'qa'; message: string; tier: 'normal' | 'priority'; displayName: string | null }
  | { kind: 'membership'; planId: string };

export interface AgentPlan {
  steps: AgentStep[];
  summary: string;
  warnings: string[];
}

export async function planAgent(
  slug: string,
  input: string,
  options: { maxSteps?: number } = {}
): Promise<AgentPlan> {
  const res = await fetch(`${API_BASE}/channels/${slug}/agent/plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input, maxSteps: options.maxSteps }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Failed to build agent plan');
  }

  return data.plan as AgentPlan;
}

export async function fetchChannel(slug: string): Promise<Channel> {
  const res = await fetch(`${API_BASE}/channels/${slug}`);
  if (!res.ok) throw new Error('Channel not found');
  return res.json();
}

export async function fetchStreamStatus(slug: string): Promise<StreamStatusResponse> {
  const res = await fetch(`${API_BASE}/channels/${slug}/stream/status`);
  const data = (await res.json()) as StreamStatusResponse;
  if (!res.ok) {
    const error = (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string')
      ? data.error
      : 'Failed to fetch stream status';
    throw new Error(error);
  }
  return data;
}

export async function fetchActions(slug: string): Promise<Action[]> {
  const res = await fetch(`${API_BASE}/channels/${slug}/actions`);
  if (!res.ok) throw new Error('Failed to fetch actions');
  return res.json();
}

export async function triggerAction(
  slug: string,
  actionKey: string,
  paymentHeader?: string
): Promise<PaymentResponse | Error402Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (paymentHeader) {
    headers['X-PAYMENT'] = paymentHeader;
  }

  const res = await fetch(`${API_BASE}/channels/${slug}/trigger`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ actionKey }),
  });

  const data = await res.json();

  if (res.status === 402) {
    return data as Error402Response;
  }

  if (!res.ok) {
    throw new Error(extractErrorMessage(data, 'Failed to trigger action'));
  }

  return data as PaymentResponse;
}

export async function donate(
  slug: string,
  amountBaseUnits: string,
  message: string | null,
  displayName: string | null,
  paymentHeader?: string
): Promise<PaymentResponse | Error402Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (paymentHeader) {
    headers['X-PAYMENT'] = paymentHeader;
  }

  const res = await fetch(`${API_BASE}/channels/${slug}/donate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amountBaseUnits, message, displayName }),
  });

  const data = await res.json();

  if (res.status === 402) {
    return data as Error402Response;
  }

  if (!res.ok) {
    throw new Error(extractErrorMessage(data, 'Failed to donate'));
  }

  return data as PaymentResponse;
}

export async function submitQA(
  slug: string,
  message: string,
  displayName: string | null,
  tier: 'normal' | 'priority',
  paymentHeader?: string
): Promise<PaymentResponse | Error402Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (paymentHeader) {
    headers['X-PAYMENT'] = paymentHeader;
  }

  const res = await fetch(`${API_BASE}/channels/${slug}/qa`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, displayName, tier }),
  });

  const data = await res.json();

  if (res.status === 402) {
    return data as Error402Response;
  }

  if (!res.ok) {
    throw new Error(extractErrorMessage(data, 'Failed to submit Q&A'));
  }

  return data as PaymentResponse;
}

export async function updateChannel(
  slug: string,
  token: string,
  settings: { streamEmbedUrl: string | null }
): Promise<UpdateChannelResponse> {
  const res = await fetch(`${API_BASE}/channels/${slug}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(settings),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Failed to update channel');
  }

  return data as UpdateChannelResponse;
}

export function is402Response(res: unknown): res is Error402Response {
  return (
    typeof res === 'object' &&
    res !== null &&
    'x402Version' in res &&
    'paymentRequirements' in res
  );
}

// Membership types and functions

export interface MembershipPlan {
  id: string;
  name: string;
  priceBaseUnits: string;
  durationDays: number;
}

export interface MembershipStatus {
  active: boolean;
  membership: {
    planId: string;
    planName: string;
    memberSince: string | null;
    revoked: boolean;
  } | null;
  nft: {
    contractAddress: string;
    tokenId: string;
  } | null;
}

export interface MembershipResponse {
  ok: true;
  membership: {
    planId: string;
  };
  payment: {
    paymentId: string;
    txHash: string;
    from: string;
    to: string;
    value: string;
    blockNumber?: number;
  };
  nft?: {
    txHash: string;
    contractAddress: string;
    tokenId: string;
    amount: string;
  };
  cached?: boolean;
}

export async function fetchMembershipPlans(slug: string): Promise<MembershipPlan[]> {
  const res = await fetch(`${API_BASE}/channels/${slug}/membership-plans`);
  if (!res.ok) throw new Error('Failed to fetch membership plans');
  return res.json();
}

export async function fetchMembershipStatus(slug: string, address: string): Promise<MembershipStatus> {
  const res = await fetch(`${API_BASE}/channels/${slug}/memberships/me?address=${address.toLowerCase()}`);
  if (!res.ok) throw new Error('Failed to fetch membership status');
  return res.json();
}

export async function subscribeMembership(
  slug: string,
  planId: string,
  paymentHeader?: string
): Promise<MembershipResponse | Error402Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (paymentHeader) {
    headers['X-PAYMENT'] = paymentHeader;
  }

  const res = await fetch(`${API_BASE}/channels/${slug}/memberships`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ planId }),
  });

  const data = await res.json();

  if (res.status === 402) {
    return data as Error402Response;
  }

  if (!res.ok) {
    throw new Error(extractErrorMessage(data, 'Failed to subscribe'));
  }

  return data as MembershipResponse;
}

// Support history types and functions

export interface SupportItem {
  paymentId: string;
  kind: string | null;
  value: string;
  txHash: string | null;
  timestamp: number | null;
  actionKey: string | null;
  qaId: string | null;
}

export interface MySupportsResponse {
  items: SupportItem[];
  nextCursor: string | null;
}

export interface FetchSupportsOptions {
  limit?: number;
  cursor?: string;
  kind?: 'effect' | 'qa' | 'donation' | 'membership';
}

export async function fetchMySupports(
  slug: string,
  address: string,
  options: FetchSupportsOptions | number = {}
): Promise<MySupportsResponse> {
  // Support legacy call signature: fetchMySupports(slug, address, limit)
  const opts = typeof options === 'number' ? { limit: options } : options;
  const { limit = 10, cursor, kind } = opts;

  const params = new URLSearchParams();
  params.set('address', address.toLowerCase());
  params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  if (kind) params.set('kind', kind);

  const res = await fetch(`${API_BASE}/channels/${slug}/supports/me?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch supports');
  return res.json();
}

// Payment Receipt types and functions

export interface PaymentReceipt {
  paymentId: string;
  status: string;
  kind: string | null;
  scheme: string;
  network: string;
  asset: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  nonce: string;
  txHash: string | null;
  blockNumber: string | null;
  timestamp: number | null;
  actionKey: string | null;
  qaId: string | null;
  membershipPlanId: string | null;
  createdAt: string;
}

export async function fetchPublicReceipt(
  slug: string,
  paymentId: string,
  address: string
): Promise<PaymentReceipt> {
  const res = await fetch(
    `${API_BASE}/channels/${slug}/payments/${paymentId}?address=${address.toLowerCase()}`
  );
  if (res.status === 403) throw new Error('Access denied: not your payment');
  if (res.status === 404) throw new Error('Payment not found');
  if (!res.ok) throw new Error('Failed to fetch receipt');
  return res.json();
}

export async function fetchDashboardReceipt(
  slug: string,
  paymentId: string,
  token: string
): Promise<PaymentReceipt> {
  const res = await fetch(`${API_BASE}/channels/${slug}/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 404) throw new Error('Payment not found');
  if (!res.ok) throw new Error('Failed to fetch receipt');
  return res.json();
}

// Profile types and functions

export interface GlobalProfile {
  address: string;
  displayName: string | null;
}

export interface ChannelProfile {
  address: string;
  globalDisplayName: string | null;
  channelDisplayNameOverride: string | null;
  effectiveDisplayName: string;
}

export interface ProfileNonce {
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}

export async function fetchGlobalProfile(address: string): Promise<GlobalProfile> {
  const res = await fetch(`${API_BASE}/profile?address=${address.toLowerCase()}`);
  if (!res.ok) throw new Error('Failed to fetch global profile');
  return res.json();
}

export async function fetchChannelProfile(slug: string, address: string): Promise<ChannelProfile> {
  const res = await fetch(`${API_BASE}/channels/${slug}/profile?address=${address.toLowerCase()}`);
  if (!res.ok) throw new Error('Failed to fetch channel profile');
  return res.json();
}

export async function fetchGlobalProfileNonce(address: string): Promise<ProfileNonce> {
  const res = await fetch(`${API_BASE}/profile/nonce?address=${address.toLowerCase()}`);
  if (!res.ok) throw new Error('Failed to fetch global profile nonce');
  return res.json();
}

export async function fetchChannelProfileNonce(slug: string, address: string): Promise<ProfileNonce> {
  const res = await fetch(`${API_BASE}/channels/${slug}/profile/nonce?address=${address.toLowerCase()}`);
  if (!res.ok) throw new Error('Failed to fetch channel profile nonce');
  return res.json();
}

export async function updateGlobalProfile(
  address: string,
  displayName: string,
  nonce: string,
  issuedAt: string,
  expiresAt: string,
  signature: string
): Promise<{ ok: true; displayName: string }> {
  const res = await fetch(`${API_BASE}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, displayName, nonce, issuedAt, expiresAt, signature }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update global profile');
  return data;
}

export async function updateChannelProfile(
  slug: string,
  address: string,
  action: 'set' | 'clear',
  nonce: string,
  issuedAt: string,
  expiresAt: string,
  signature: string,
  displayNameOverride?: string
): Promise<{ ok: true; displayNameOverride?: string; cleared?: boolean }> {
  const res = await fetch(`${API_BASE}/channels/${slug}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address,
      action,
      displayNameOverride: action === 'set' ? displayNameOverride : undefined,
      nonce,
      issuedAt,
      expiresAt,
      signature,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update channel profile');
  return data;
}
