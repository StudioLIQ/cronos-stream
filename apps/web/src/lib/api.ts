const API_BASE = '/api';

export interface Channel {
  slug: string;
  displayName: string;
  payToAddress: string;
  network: string;
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

export function is402Response(res: unknown): res is Error402Response {
  return (
    typeof res === 'object' &&
    res !== null &&
    'x402Version' in res &&
    'paymentRequirements' in res
  );
}
