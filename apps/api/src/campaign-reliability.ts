/**
 * Campaign reliability helpers. These helpers never send WhatsApp messages.
 * Provider 130429 means Meta rejected a request due to throttling; it does not
 * mean an earlier/other request failed, and must not trigger broad replay.
 */
export type RateLimitError = { code: 130429; retryAfterMs?: number };
export function getMetaRateLimit(error: unknown): RateLimitError | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;
  const nested = e.error && typeof e.error === 'object'
    ? e.error as Record<string, unknown> : e;
  const code = Number(nested.code ?? e.code);
  if (code !== 130429) return null;
  const raw = nested.retryAfterMs ?? e.retryAfterMs;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return { code: 130429, ...(raw != null && Number.isFinite(n) && n >= 0
    ? { retryAfterMs: Math.min(n, 3_600_000) } : {}) };
}
/** Deterministic backoff, capped at 15 minutes. attempts starts at 1. */
export function rateLimitBackoffMs(attempts: number, retryAfterMs?: number): number {
  if (!Number.isInteger(attempts) || attempts < 1) throw Error('Invalid attempt count');
  const exp = Math.min(900_000, 30_000 * 2 ** Math.min(attempts - 1, 10));
  return Math.min(900_000, Math.max(exp, retryAfterMs ?? 0));
}
export function isReviewCandidate(input: {
  status: string; updatedAt: Date; cutoff: Date; jobState: string;
}): boolean {
  // No automatic retry: ambiguous sends require human/provider reconciliation.
  return input.status === 'PROCESSING' &&
    input.updatedAt.getTime() < input.cutoff.getTime() &&
    !['active', 'waiting', 'delayed', 'waiting-children', 'paused', 'unknown'].includes(input.jobState);
}
