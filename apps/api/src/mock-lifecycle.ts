export type MockCounts = {
 queued: number;
 active: number;
 MOCK_SENT: number;
 failed: number;
 skipped: number;
};

// Pure deterministic status calculation; never sends any messages.
export function mockCampaignStatus(counts: MockCounts): 'COMPLETED' | 'PARTIAL' | 'FAILED' {
 if (counts.failed > 0 || counts.skipped > 0) {
  return counts.MOCK_SENT > 0 ? 'PARTIAL' : 'FAILED';
 }
 return 'COMPLETED';
}
