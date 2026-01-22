function normalizeApiBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '/api';
  return trimmed.replace(/\/+$/, '');
}

export const API_BASE = normalizeApiBase(import.meta.env.VITE_API_URL ?? '/api');

