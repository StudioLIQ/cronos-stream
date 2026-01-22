const DASHBOARD_TOKEN_STORAGE_KEY = 'stream402.dashboardToken';

export function getStoredDashboardToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = window.localStorage.getItem(DASHBOARD_TOKEN_STORAGE_KEY);
    return token && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

export function storeDashboardToken(token: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = token.trim();
  if (!trimmed) return;
  try {
    window.localStorage.setItem(DASHBOARD_TOKEN_STORAGE_KEY, trimmed);
  } catch {
    // ignore storage errors
  }
}

export function clearStoredDashboardToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DASHBOARD_TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function buildDashboardAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
  };
}

