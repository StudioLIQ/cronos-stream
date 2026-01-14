import { getNetworkConfig, DEFAULT_TIMEOUT_SECONDS } from './constants.js';
import type { PaymentRequirements, PaymentRequirementsResponse } from './types.js';

const AMOUNT_REGEX = /^\d+$/;

export interface BuildPaymentRequirementsParams {
  network: string;
  payTo: string;
  amount: string;
  description: string;
  mimeType?: string;
  timeoutSeconds?: number;
}

export function validateAmount(amount: string): void {
  if (!AMOUNT_REGEX.test(amount)) {
    throw new Error(`Invalid amount: "${amount}". Must be a non-negative integer string (base units).`);
  }
}

export function buildPaymentRequirements(
  params: BuildPaymentRequirementsParams
): PaymentRequirements {
  const {
    network,
    payTo,
    amount,
    description,
    mimeType = 'application/json',
    timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  } = params;

  validateAmount(amount);

  const networkConfig = getNetworkConfig(network);

  return {
    scheme: 'exact',
    network,
    payTo,
    asset: networkConfig.usdcAddress,
    description,
    mimeType,
    maxAmountRequired: amount,
    maxTimeoutSeconds: timeoutSeconds,
  };
}

export function build402Response(requirements: PaymentRequirements): PaymentRequirementsResponse {
  return {
    error: 'Payment Required',
    x402Version: 1,
    paymentRequirements: requirements,
  };
}
