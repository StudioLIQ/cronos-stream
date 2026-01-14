import axios, { AxiosError } from 'axios';
import { FACILITATOR_URL } from './constants.js';
import type {
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SettleSuccessResponse,
  SettleFailureResponse,
} from './types.js';
import { logger } from '../logger.js';

const TIMEOUT_MS = 15000;

interface FacilitatorRequestBody {
  x402Version: 1;
  paymentHeader: string;
  paymentRequirements: PaymentRequirements;
}

function buildRequestBody(
  paymentHeaderBase64: string,
  paymentRequirements: PaymentRequirements
): FacilitatorRequestBody {
  return {
    x402Version: 1,
    paymentHeader: paymentHeaderBase64,
    paymentRequirements,
  };
}

export async function verifyPayment(params: {
  paymentHeaderBase64: string;
  paymentRequirements: PaymentRequirements;
}): Promise<VerifyResponse> {
  const { paymentHeaderBase64, paymentRequirements } = params;

  logger.debug('Verifying payment with facilitator', {
    url: `${FACILITATOR_URL}/verify`,
  });

  try {
    const response = await axios.post<VerifyResponse>(
      `${FACILITATOR_URL}/verify`,
      buildRequestBody(paymentHeaderBase64, paymentRequirements),
      {
        headers: {
          'Content-Type': 'application/json',
          'X402-Version': '1',
        },
        timeout: TIMEOUT_MS,
      }
    );

    logger.debug('Verify response', response.data);
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: string; invalidReason?: string }>;

    if (axiosError.response) {
      logger.warn('Verify returned error response', {
        status: axiosError.response.status,
        data: axiosError.response.data,
      });

      // Extract invalidReason from error response if present
      const invalidReason =
        axiosError.response.data?.invalidReason ||
        axiosError.response.data?.error ||
        `HTTP ${axiosError.response.status}`;

      return {
        isValid: false,
        invalidReason,
      };
    }

    logger.error('Verify request failed', { message: axiosError.message });
    return {
      isValid: false,
      invalidReason: `Network error: ${axiosError.message}`,
    };
  }
}

export async function settlePayment(params: {
  paymentHeaderBase64: string;
  paymentRequirements: PaymentRequirements;
}): Promise<SettleResponse> {
  const { paymentHeaderBase64, paymentRequirements } = params;

  logger.debug('Settling payment with facilitator', {
    url: `${FACILITATOR_URL}/settle`,
  });

  try {
    const response = await axios.post<SettleSuccessResponse>(
      `${FACILITATOR_URL}/settle`,
      buildRequestBody(paymentHeaderBase64, paymentRequirements),
      {
        headers: {
          'Content-Type': 'application/json',
          'X402-Version': '1',
        },
        timeout: TIMEOUT_MS,
      }
    );

    logger.info('Settle success', {
      txHash: response.data.txHash,
      from: response.data.from,
      to: response.data.to,
      value: response.data.value,
    });

    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError<{ error?: string; event?: string }>;

    if (axiosError.response) {
      logger.warn('Settle returned error response', {
        status: axiosError.response.status,
        data: axiosError.response.data,
      });

      const errorMessage =
        axiosError.response.data?.error ||
        `Settlement failed: HTTP ${axiosError.response.status}`;

      return {
        event: 'payment.failed',
        error: errorMessage,
      } as SettleFailureResponse;
    }

    logger.error('Settle request failed', { message: axiosError.message });
    return {
      event: 'payment.failed',
      error: `Network error: ${axiosError.message}`,
    } as SettleFailureResponse;
  }
}

export function isSettleSuccess(
  response: SettleResponse
): response is SettleSuccessResponse {
  return response.event === 'payment.settled';
}

export function isSettleFailure(
  response: SettleResponse
): response is SettleFailureResponse {
  return response.event === 'payment.failed';
}
