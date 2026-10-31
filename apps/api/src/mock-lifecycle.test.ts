import { describe, expect, it } from 'vitest';
import { mockCampaignStatus } from './mock-lifecycle';

describe('mock campaign terminal state', () => {
 it('marks every successful mock delivery completed', () =>
  expect(mockCampaignStatus({queued:0,active:0,MOCK_SENT:1000,failed:0,skipped:0})).toBe('COMPLETED'));
 it('keeps partial success distinct from failure', () =>
  expect(mockCampaignStatus({queued:0,active:0,MOCK_SENT:998,failed:2,skipped:0})).toBe('PARTIAL'));
 it('marks all skipped as failed rather than delivered', () =>
  expect(mockCampaignStatus({queued:0,active:0,MOCK_SENT:0,failed:0,skipped:100})).toBe('FAILED'));
});
