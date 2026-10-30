// Safe crash recovery: dry run by default. --apply ONLY flags ambiguous rows
// REVIEW_REQUIRED; it NEVER retries or sends messages.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { Queue } = require('bullmq');
const db = new PrismaClient();
const queue = new Queue('consented-campaigns', { connection: {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
} });
const apply = process.argv.includes('--apply');
async function main() {
  const minutes = Number(process.env.RECOVERY_AUDIT_MINUTES || 15);
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 10080) {
    throw Error('RECOVERY_AUDIT_MINUTES must be 15..10080');
  }
  const cutoff = new Date(Date.now() - minutes * 60_000);
  const rows = await db.campaignRecipient.findMany({
    where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
    select: { id: true, campaignId: true, contactId: true, tenantId: true, updatedAt: true },
    take: 100,
    orderBy: { updatedAt: 'asc' },
  });
  let candidates = 0, flagged = 0;
  for (const row of rows) {
    const job = await queue.getJob(`campaign-${row.campaignId}-contact-${row.contactId}`);
    const state = job ? await job.getState() : 'missing';
    // Completed/failed/missing jobs still require manual provider reconciliation.
    if (!['missing', 'completed', 'failed'].includes(state)) continue;
    candidates++;
    if (!apply) {
      console.log('DRY_RUN_REVIEW_REQUIRED', { id: row.id, jobState: state });
      continue;
    }
    // CAS protects against a worker that has changed this row since our read.
    const changed = await db.campaignRecipient.updateMany({
      where: { id: row.id, tenantId: row.tenantId, status: 'PROCESSING', updatedAt: row.updatedAt },
      data: { status: 'REVIEW_REQUIRED' },
    });
    flagged += changed.count;
    console.log('REVIEW_REQUIRED', { id: row.id, changed: changed.count });
  }
  console.log({ mode: apply ? 'APPLY_REVIEW_ONLY' : 'DRY_RUN', inspected: rows.length, candidates, flagged });
  console.log('Never resend REVIEW_REQUIRED rows without provider/webhook reconciliation.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; })
  .finally(async () => { await Promise.allSettled([queue.close(), db.$disconnect()]); });
