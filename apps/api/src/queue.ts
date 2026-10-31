import 'dotenv/config';
import { Queue, Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { MockProvider } from './provider';
import { mockCampaignStatus } from './mock-lifecycle';

const db = new PrismaClient();
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
};
const queueName = 'consented-campaigns';
export const campaignQueue = new Queue(queueName, { connection });
const onlyMock = () => process.env.SEND_MODE === 'mock' && process.env.META_CAMPAIGN_SEND_ENABLED !== 'true';
const selectedIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  : [];
const jobId = (campaignId: string, contactId: string) => `campaign-${campaignId}-contact-${contactId}`;

async function addMissingJobs(campaignId: string, tenantId: string) {
  const pending = await db.mockCampaignDelivery.findMany({
    where: { campaignId, tenantId, status: 'QUEUED' },
    select: { contactId: true },
  });
  for (const row of pending) {
    const id = jobId(campaignId, row.contactId);
    const existing = await campaignQueue.getJob(id);
    if (!existing) {
      await campaignQueue.add('mock-send', { campaignId, tenantId, contactId: row.contactId },
        { jobId: id, attempts: 1 });
    } else if (await existing.getState() === 'failed') {
      // Failed jobs are terminal and require an explicit retry.
      await db.mockCampaignDelivery.updateMany({
        where: { campaignId, tenantId, contactId: row.contactId, status: 'QUEUED' },
        data: { status: 'FAILED', lastError: 'Previous queue attempt failed' },
      });
    }
  }
  return pending.length;
}

export async function enqueueCampaign(campaignId: string, tenantId: string) {
  if (!onlyMock()) throw Error('Mock mode required');
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, tenantId, status: 'DRAFT' } });
  if (!campaign) throw Error('Draft campaign unavailable');
  const ids = selectedIds(campaign.recipientIds);
  if (!ids.length) throw Error('Choose at least one opted-in contact');
  const valid = await db.contact.count({ where: { tenantId, consent: true, id: { in: ids } } });
  if (valid !== ids.length) throw Error('Some selected contacts are no longer opted in');

  // Persist all intended recipients before enqueueing any jobs.
  await db.mockCampaignDelivery.createMany({
    data: ids.map(contactId => ({ tenantId, campaignId, contactId, status: 'QUEUED' })),
    skipDuplicates: true,
  });
  const claimed = await db.campaign.updateMany({
    where: { id: campaignId, tenantId, status: 'DRAFT' },
    data: { status: 'QUEUED' },
  });
  if (claimed.count !== 1) throw Error('Campaign already started');
  // Crash here is recoverable by recoverQueuedMockCampaigns after restart.
  try {
    await addMissingJobs(campaignId, tenantId);
  } catch (error) {
    console.error('Mock enqueue incomplete; recovery can resume pending recipients', error);
    throw error;
  }
  return { queued: ids.length };
}

export async function getMockCampaignProgress(campaignId: string, tenantId: string) {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign) throw Error('Campaign not found');
  const total = selectedIds(campaign.recipientIds).length;
  const grouped = await db.mockCampaignDelivery.groupBy({
    by: ['status'], where: { campaignId, tenantId }, _count: { _all: true },
  });
  const counts = { queued: 0, active: 0, MOCK_SENT: 0, failed: 0, skipped: 0 };
  for (const row of grouped) {
    const n = row._count._all;
    if (row.status === 'MOCK_SENT') counts.MOCK_SENT += n;
    else if (row.status === 'FAILED') counts.failed += n;
    else if (row.status === 'SKIPPED') counts.skipped += n;
    else if (row.status === 'ACTIVE') counts.active += n;
    else counts.queued += n;
  }
  // A campaign started before the ledger migration can remain visible without inventing deliveries.
  const recorded = grouped.reduce((sum, row) => sum + row._count._all, 0);
  counts.queued += Math.max(0, total - recorded);
  let campaignStatus = campaign.status;
  if (campaignStatus === 'QUEUED' && total > 0 &&
    recorded === total && counts.queued === 0 && counts.active === 0) {
    const next = mockCampaignStatus(counts);
    await db.campaign.updateMany({
      where: { id: campaignId, tenantId, status: 'QUEUED' }, data: { status: next },
    });
    const refreshed = await db.campaign.findFirst({ where: { id: campaignId, tenantId }, select: { status: true } });
    campaignStatus = refreshed?.status || campaignStatus;
  }
  return { campaignStatus, total, counts };
}

export async function getMockDeliveryHistory(campaignId: string, tenantId: string) {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, tenantId }, select: { id: true } });
  if (!campaign) throw Error('Campaign not found');
  return db.mockCampaignDelivery.findMany({
    where: { campaignId, tenantId },
    select: { contactId: true, status: true, attempts: true, lastError: true, updatedAt: true },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
}

export async function retryFailedMockCampaign(campaignId: string, tenantId: string) {
  if (!onlyMock()) throw Error('Mock mode required');
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign || !['FAILED', 'PARTIAL'].includes(campaign.status)) throw Error('Only failed or partial mock campaigns can be retried');
  const failures = await db.mockCampaignDelivery.findMany({
    where: { campaignId, tenantId, status: 'FAILED' }, select: { contactId: true },
  });
  if (!failures.length) throw Error('No failed recipients to retry');
  const ids = failures.map(row => row.contactId);
  const consented = await db.contact.count({ where: { tenantId, consent: true, id: { in: ids } } });
  if (consented !== ids.length) throw Error('Some failed recipients opted out; retry cancelled');

  const claimed = await db.campaign.updateMany({
    where: { id: campaignId, tenantId, status: { in: ['FAILED', 'PARTIAL'] } },
    data: { status: 'QUEUED' },
  });
  if (!claimed.count) throw Error('Campaign retry already started');
  await db.mockCampaignDelivery.updateMany({
    where: { campaignId, tenantId, contactId: { in: ids }, status: 'FAILED' },
    data: { status: 'QUEUED', lastError: null },
  });
  for (const id of ids) {
    const job = await campaignQueue.getJob(jobId(campaignId, id));
    if (job && await job.getState() === 'failed') await job.retry();
    else if (!job) await campaignQueue.add('mock-send', { campaignId, tenantId, contactId: id },
      { jobId: jobId(campaignId, id), attempts: 1 });
  }
  return { retried: ids.length };
}

export async function recoverQueuedMockCampaigns() {
  if (!onlyMock()) return { recovered: 0 };
  const campaigns = await db.campaign.findMany({
    where: { status: 'QUEUED' }, select: { id: true, tenantId: true },
    take: 100,
  });
  let recovered = 0;
  for (const campaign of campaigns) {
    recovered += await addMissingJobs(campaign.id, campaign.tenantId);
    await getMockCampaignProgress(campaign.id, campaign.tenantId);
  }
  return { recovered };
}

export function startWorker() {
  if (!onlyMock()) throw Error('This worker is mock-only');
  const worker = new Worker(queueName, async (job: Job) => {
    if (!onlyMock()) throw Error('Worker is mock-only');
    const { campaignId, tenantId, contactId } = job.data;
    if (![campaignId, tenantId, contactId].every(x => typeof x === 'string')) throw Error('Invalid mock job');
    const row = await db.mockCampaignDelivery.findFirst({ where: { campaignId, tenantId, contactId } });
    if (!row) return { skipped: true };
    if (row.status === 'MOCK_SENT') return { id: row.mockId, replayed: true };
    const [campaign, contact] = await Promise.all([
      db.campaign.findFirst({ where: { id: campaignId, tenantId } }),
      db.contact.findFirst({ where: { id: contactId, tenantId, consent: true } }),
    ]);
    if (!campaign || !contact || campaign.status !== 'QUEUED' ||
      !selectedIds(campaign.recipientIds).includes(contactId)) {
      await db.mockCampaignDelivery.updateMany({
        where: { id: row.id, status: { not: 'MOCK_SENT' } },
        data: { status: 'SKIPPED', lastError: 'Recipient no longer eligible' },
      });
      return { skipped: true };
    }
    await db.mockCampaignDelivery.update({ where: { id: row.id }, data: { status: 'ACTIVE', attempts: { increment: 1 } } });
    try {
      const result = await new MockProvider().send({
        to: contact.phone, template: campaign.templateName, language: 'en_US',
      });
      await db.mockCampaignDelivery.update({
        where: { id: row.id }, data: { status: 'MOCK_SENT', mockId: result.id, lastError: null },
      });
      return result;
    } catch (error) {
      await db.mockCampaignDelivery.update({
        where: { id: row.id },
        data: { status: 'FAILED', lastError: error instanceof Error ? error.message.slice(0, 500) : 'Mock send failed' },
      });
      throw error;
    }
  }, { connection, concurrency: 2 });

  const reconcile = (job?: Job) => {
    const { campaignId, tenantId } = job?.data || {};
    if (typeof campaignId === 'string' && typeof tenantId === 'string') {
      void getMockCampaignProgress(campaignId, tenantId).catch(error => console.error('Mock reconcile failed', error));
    }
  };
  worker.on('completed', reconcile);
  worker.on('failed', reconcile);
  void recoverQueuedMockCampaigns().then(result =>
    console.log('Mock recovery complete', result)).catch(error => console.error('Mock recovery failed', error));
  return worker;
}
