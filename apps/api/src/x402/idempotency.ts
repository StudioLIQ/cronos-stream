import crypto from 'crypto';
import { queryOne, execute } from '../db/db.js';
import { logger } from '../logger.js';
import type { SettleSuccessResponse, PaymentHeader } from './types.js';

export type PaymentKind = 'effect' | 'qa' | 'donation' | 'membership';

export interface StoredPayment {
  id: string;
  channelId: string;
  paymentId: string;
  status: 'verified' | 'settled' | 'failed';
  scheme: string;
  network: string;
  asset: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  nonce: string;
  txHash: string | null;
  nftTxHash: string | null;
  nftError: string | null;
  blockNumber: number | null;
  timestamp: number | null;
  error: string | null;
  kind: PaymentKind | null;
  actionKey: string | null;
  qaId: string | null;
  membershipPlanId: string | null;
  createdAt: string;
}

export function computePaymentId(paymentHeaderBase64: string): string {
  return crypto.createHash('sha256').update(paymentHeaderBase64).digest('hex');
}

export async function getExistingPayment(paymentId: string): Promise<StoredPayment | undefined> {
  return queryOne<StoredPayment>(
    'SELECT * FROM payments WHERE paymentId = ?',
    [paymentId]
  );
}

export function parsePaymentHeader(paymentHeaderBase64: string): PaymentHeader {
  const json = Buffer.from(paymentHeaderBase64, 'base64').toString('utf-8');
  return JSON.parse(json) as PaymentHeader;
}

export interface PaymentContext {
  kind: PaymentKind;
  actionKey?: string;
  qaId?: string;
  membershipPlanId?: string;
}

export async function createVerifiedPayment(params: {
  channelId: string;
  paymentId: string;
  paymentHeader: PaymentHeader;
  context?: PaymentContext;
}): Promise<string> {
  const { channelId, paymentId, paymentHeader, context } = params;
  const id = crypto.randomUUID();

  await execute(
    `INSERT INTO payments (id, channelId, paymentId, status, scheme, network, asset, fromAddress, toAddress, value, nonce, kind, actionKey, qaId, membershipPlanId)
     VALUES (?, ?, ?, 'verified', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      channelId,
      paymentId,
      paymentHeader.scheme,
      paymentHeader.network,
      paymentHeader.payload.asset,
      paymentHeader.payload.from,
      paymentHeader.payload.to,
      paymentHeader.payload.value,
      paymentHeader.payload.nonce,
      context?.kind ?? null,
      context?.actionKey ?? null,
      context?.qaId ?? null,
      context?.membershipPlanId ?? null,
    ]
  );

  logger.info('Created verified payment record', { id, paymentId, kind: context?.kind });
  return id;
}

export async function updatePaymentContext(
  paymentId: string,
  context: Partial<PaymentContext>
): Promise<void> {
  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (context.kind !== undefined) {
    updates.push('kind = ?');
    values.push(context.kind);
  }
  if (context.actionKey !== undefined) {
    updates.push('actionKey = ?');
    values.push(context.actionKey ?? null);
  }
  if (context.qaId !== undefined) {
    updates.push('qaId = ?');
    values.push(context.qaId ?? null);
  }
  if (context.membershipPlanId !== undefined) {
    updates.push('membershipPlanId = ?');
    values.push(context.membershipPlanId ?? null);
  }

  if (updates.length === 0) return;

  values.push(paymentId);
  await execute(
    `UPDATE payments SET ${updates.join(', ')} WHERE paymentId = ?`,
    values
  );
}

export async function markPaymentSettled(
  paymentId: string,
  settleResult: SettleSuccessResponse
): Promise<void> {
  await execute(
    `UPDATE payments SET status = 'settled', txHash = ?, blockNumber = ?, timestamp = ?
     WHERE paymentId = ?`,
    [
      settleResult.txHash,
      settleResult.blockNumber,
      settleResult.timestamp,
      paymentId,
    ]
  );

  logger.info('Marked payment as settled', { paymentId, txHash: settleResult.txHash });
}

export async function markPaymentFailed(paymentId: string, error: string): Promise<void> {
  await execute(
    `UPDATE payments SET status = 'failed', error = ?
     WHERE paymentId = ?`,
    [error, paymentId]
  );

  logger.warn('Marked payment as failed', { paymentId, error });
}

export async function markPaymentNftMinted(paymentId: string, nftTxHash: string): Promise<void> {
  await execute(
    `UPDATE payments SET nftTxHash = ?, nftError = NULL
     WHERE paymentId = ?`,
    [nftTxHash, paymentId]
  );
}

export async function markPaymentNftFailed(paymentId: string, nftError: string): Promise<void> {
  await execute(
    `UPDATE payments SET nftError = ?
     WHERE paymentId = ?`,
    [nftError, paymentId]
  );
}

export interface IdempotentPaymentResult {
  isNew: boolean;
  payment: StoredPayment;
  alreadySettled: boolean;
}

export async function checkIdempotency(
  paymentHeaderBase64: string,
  channelId: string
): Promise<{ paymentId: string; existing: StoredPayment | undefined }> {
  const paymentId = computePaymentId(paymentHeaderBase64);
  const existing = await getExistingPayment(paymentId);

  if (existing) {
    logger.info('Found existing payment', {
      paymentId,
      status: existing.status,
    });
  }

  return { paymentId, existing };
}
