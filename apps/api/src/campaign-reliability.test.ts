import { describe, it, expect } from 'vitest';
import { getMetaRateLimit, rateLimitBackoffMs, isReviewCandidate } from './campaign-reliability';
describe('Meta 130429 handling', () => {
  it('recognizes nested Meta error', () => {
    expect(getMetaRateLimit({ error: { code: 130429 } })).toEqual({ code: 130429 });
    expect(getMetaRateLimit({ error: { code: 131000 } })).toBeNull();
    expect(getMetaRateLimit(null)).toBeNull();
  });
  it('bounds retry-after and backoff', () => {
    expect(rateLimitBackoffMs(1)).toBe(30_000);
    expect(rateLimitBackoffMs(2)).toBe(60_000);
    expect(rateLimitBackoffMs(9)).toBe(900_000);
    expect(rateLimitBackoffMs(1, 90_000)).toBe(90_000);
    expect(() => rateLimitBackoffMs(0)).toThrow();
  });
});
describe('crash recovery safety', () => {
  const base = { status: 'PROCESSING', updatedAt: new Date('2026-10-30T10:00:00Z'), cutoff: new Date('2026-10-30T10:15:00Z') };
  it('never marks active or queued work as reviewable', () => {
    for (const jobState of ['active', 'waiting', 'delayed', 'paused', 'unknown']) {
      expect(isReviewCandidate({ ...base, jobState })).toBe(false);
    }
  });
  it('only allows stale processing with no active job for manual review', () => {
    expect(isReviewCandidate({ ...base, jobState: 'missing' })).toBe(true);
    expect(isReviewCandidate({ ...base, status: 'MOCK_SENT', jobState: 'missing' })).toBe(false);
    expect(isReviewCandidate({ ...base, updatedAt: new Date('2026-10-30T10:20:00Z'), jobState: 'missing' })).toBe(false);
  });
});
