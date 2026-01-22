type ErrorLike = {
  code?: unknown;
  message?: unknown;
  error?: { code?: unknown; message?: unknown } | unknown;
  cause?: { code?: unknown; message?: unknown } | unknown;
  info?: { error?: { code?: unknown; message?: unknown } | unknown } | unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function getErrorCode(err: unknown): unknown {
  const e = err as ErrorLike;
  if (e && e.code !== undefined) return e.code;

  const errorObj = asObject((e as ErrorLike | undefined)?.error);
  if (errorObj && 'code' in errorObj) return (errorObj as { code?: unknown }).code;

  const causeObj = asObject((e as ErrorLike | undefined)?.cause);
  if (causeObj && 'code' in causeObj) return (causeObj as { code?: unknown }).code;

  const infoObj = asObject((e as ErrorLike | undefined)?.info);
  if (infoObj && 'error' in infoObj) {
    const nested = asObject(infoObj.error);
    if (nested && 'code' in nested) return (nested as { code?: unknown }).code;
  }

  return undefined;
}

export function getErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error && typeof err.message === 'string' && err.message.trim()) {
    return err.message.trim();
  }
  if (typeof err === 'string' && err.trim()) return err.trim();

  const e = err as ErrorLike;
  if (e && typeof e.message === 'string' && e.message.trim()) return e.message.trim();

  const nested = asObject((e as ErrorLike | undefined)?.error);
  if (nested && typeof (nested as { message?: unknown }).message === 'string') {
    const message = (nested as { message?: string }).message;
    if (message && message.trim()) return message.trim();
  }

  return fallback;
}

export function isUserRejectedWalletRequest(err: unknown): boolean {
  const code = getErrorCode(err);

  // EIP-1193 / MetaMask: 4001 (user rejected request)
  if (code === 4001) return true;

  // ethers: ACTION_REJECTED (user rejected action)
  if (code === 'ACTION_REJECTED') return true;

  const message = getErrorMessage(err, '').toLowerCase();
  if (!message) return false;

  // Common wallet/provider cancellation messages
  if (message.includes('user rejected')) return true;
  if (message.includes('user denied')) return true;
  if (message.includes('rejected the request')) return true;
  if (message.includes('denied message signature')) return true;
  if (message.includes('action_rejected')) return true;

  return false;
}

export function formatWalletSignatureError(err: unknown): string {
  if (isUserRejectedWalletRequest(err)) {
    return 'Signature request was cancelled in your wallet.';
  }
  return getErrorMessage(err);
}

