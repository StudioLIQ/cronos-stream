import crypto from 'crypto';
import { queryOne, execute } from '../db/db.js';
import { logger } from '../logger.js';
import type { SettleSuccessResponse, PaymentHeader } from './types.js';

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
  blockNumber: number | null;
  timestamp: number | null;
  error: string | null;
  createdAt: string;
}

export function computePaymentId(paymentHeaderBase64: string): string {
  return crypto.createHash('sha256').update(paymentHeaderBase64).digest('hex');
}

export function getExistingPayment(paymentId: string): StoredPayment | undefined {
  return queryOne<StoredPayment>(
    'SELECT * FROM payments WHERE paymentId = ?',
    [paymentId]
  );
}

export function parsePaymentHeader(paymentHeaderBase64: string): PaymentHeader {
  const json = Buffer.from(paymentHeaderBase64, 'base64').toString('utf-8');
  return JSON.parse(json) as PaymentHeader;
}

export function createVerifiedPayment(params: {
  channelId: string;
  paymentId: string;
  paymentHeader: PaymentHeader;
}): string {
  const { channelId, paymentId, paymentHeader } = params;
  const id = crypto.randomUUID();

  execute(
    `INSERT INTO payments (id, channelId, paymentId, status, scheme, network, asset, fromAddress, toAddress, value, nonce)
     VALUES (?, ?, ?, 'verified', ?, ?, ?, ?, ?, ?, ?)`,
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
    ]
  );

  logger.info('Created verified payment record', { id, paymentId });
  return id;
}

export function markPaymentSettled(
  paymentId: string,
  settleResult: SettleSuccessResponse
): void {
  execute(
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

export function markPaymentFailed(paymentId: string, error: string): void {
  execute(
    `UPDATE payments SET status = 'failed', error = ?
     WHERE paymentId = ?`,
    [error, paymentId]
  );

  logger.warn('Marked payment as failed', { paymentId, error });
}

export interface IdempotentPaymentResult {
  isNew: boolean;
  payment: StoredPayment;
  alreadySettled: boolean;
}

export function checkIdempotency(
  paymentHeaderBase64: string,
  channelId: string
): { paymentId: string; existing: StoredPayment | undefined } {
  const paymentId = computePaymentId(paymentHeaderBase64);
  const existing = getExistingPayment(paymentId);

  if (existing) {
    logger.info('Found existing payment', {
      paymentId,
      status: existing.status,
    });
  }

  return { paymentId, existing };
}
