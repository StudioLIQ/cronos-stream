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

export interface PaymentPayload {
  from: string;
  to: string;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
  signature: string;
  asset: string;
}

export interface PaymentHeader {
  x402Version: 1;
  scheme: 'exact';
  network: string;
  payload: PaymentPayload;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason: string | null;
}

export interface SettleSuccessResponse {
  event: 'payment.settled';
  txHash: string;
  from: string;
  to: string;
  value: string;
  // Facilitator implementations vary: some return numbers, others return strings (ISO or unix).
  blockNumber: number | string;
  timestamp: number | string;
}

export interface SettleFailureResponse {
  event: 'payment.failed';
  error: string;
}

export type SettleResponse = SettleSuccessResponse | SettleFailureResponse;

export interface PaymentRequirementsResponse {
  error: string;
  x402Version: 1;
  paymentRequirements: PaymentRequirements;
}
