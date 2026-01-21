const API_BASE = '/api';

export interface Channel {
  slug: string;
  displayName: string;
  payToAddress: string;
  network: string;
  streamEmbedUrl?: string | null;
}

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

export async function fetchChannel(slug: string): Promise<Channel> {
  const res = await fetch(`${API_BASE}/channels/${slug}`);
  if (!res.ok) throw new Error('Channel not found');
  return res.json();
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
    throw new Error(data.error || 'Failed to trigger action');
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
    throw new Error(data.error || 'Failed to donate');
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
    throw new Error(data.error || 'Failed to submit Q&A');
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
    expiresAt: string;
    revoked: boolean;
  } | null;
}

export interface MembershipResponse {
  ok: true;
  membership: {
    planId: string;
    expiresAt: string;
  };
  payment: {
    paymentId: string;
    txHash: string;
    from: string;
    to: string;
    value: string;
    blockNumber?: number;
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
    throw new Error(data.error || 'Failed to subscribe');
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

export async function fetchMySupports(slug: string, address: string, limit = 10): Promise<MySupportsResponse> {
  const res = await fetch(`${API_BASE}/channels/${slug}/supports/me?address=${address.toLowerCase()}&limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch supports');
  return res.json();
}
