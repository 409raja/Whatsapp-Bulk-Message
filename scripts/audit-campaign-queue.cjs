// Read-only diagnostics for recipient ledger and BullMQ. No campaign sends or DB writes.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { Queue } = require('bullmq');

const db = new PrismaClient();
const queue = new Queue('consented-campaigns', {
  connection: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
  },
});
const thresholdMinutes = Number(process.env.RECOVERY_AUDIT_MINUTES || 15);

async function main() {
  if (!Number.isInteger(thresholdMinutes) || thresholdMinutes < 1 || thresholdMinutes > 10080) {
    throw new Error('RECOVERY_AUDIT_MINUTES must be an integer between 1 and 10080');
  }
  const table = await db.$queryRaw`SELECT to_regclass('public."CampaignRecipient"')::text AS name`;
  if (!table[0]?.name) {
    console.log('CampaignRecipient table not found. Apply the reviewed local migration first.');
    return;
  }
  const counts = await db.campaignRecipient.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  console.log('Recipient statuses:', JSON.stringify(counts));
  console.log('Queue counts:', JSON.stringify(await queue.getJobCounts(
    'waiting', 'active', 'delayed', 'completed', 'failed', 'paused', 'waiting-children'
  )));
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  const rows = await db.campaignRecipient.findMany({
    where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
    select: { id: true, tenantId: true, campaignId: true, contactId: true, attempts: true, updatedAt: true },
    orderBy: { updatedAt: 'asc' },
    take: 100,
  });
  console.log('Potentially stale PROCESSING recipients:', rows.length);
  for (const row of rows) {
    const jobId = `campaign-${row.campaignId}-contact-${row.contactId}`;
    const job = await queue.getJob(jobId);
    const state = job ? await job.getState() : 'missing';
    console.log(JSON.stringify({
      recipientId: row.id, campaignId: row.campaignId,
      updatedAt: row.updatedAt, attempts: row.attempts,
      jobState: state, review: 'MANUAL_REVIEW_ONLY',
    }));
  }
  console.log('No state changes performed. Missing jobs do NOT prove provider delivery did not occur.');
}
main().catch(error => {
  console.error('Audit failed:', error.message);
  process.exitCode = 1;
}).finally(async () => {
  await Promise.allSettled([queue.close(), db.$disconnect()]);
});
