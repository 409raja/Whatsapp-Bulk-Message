// Prisma's groupBy typings allow optional _count and a boolean select form.
// Normalize them here rather than casting database results to a stricter type.
export type StatusRow = { status: string; _count?: { _all?: number } | boolean | null };
const rowCount = (row: StatusRow): number => {
  const count = row._count;
  return count && typeof count === 'object' && typeof count._all === 'number' ? count._all : 0;
};

export function aggregateMockStats(campaignRows: StatusRow[], deliveryRows: StatusRow[]) {
  const sum = (rows: StatusRow[], status: string) => rows
    .filter(row => row.status === status)
    .reduce((total, row) => total + rowCount(row), 0);
  return {
    mode: 'MOCK_ONLY' as const,
    campaigns: {
      total: campaignRows.reduce((total, row) => total + rowCount(row), 0),
      completed: sum(campaignRows, 'COMPLETED'),
      partial: sum(campaignRows, 'PARTIAL'),
      failed: sum(campaignRows, 'FAILED'),
      queued: sum(campaignRows, 'QUEUED'),
    },
    deliveries: {
      mockSent: sum(deliveryRows, 'MOCK_SENT'),
      failed: sum(deliveryRows, 'FAILED'),
      skipped: sum(deliveryRows, 'SKIPPED'),
      queued: sum(deliveryRows, 'QUEUED'),
      active: sum(deliveryRows, 'ACTIVE'),
    },
  };
}
