import 'dotenv/config';
import { Queue, Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { MockProvider } from './provider';

const db = new PrismaClient();
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
};
const queueName = 'consented-campaigns';
export const campaignQueue = new Queue(queueName, { connection });

function onlyMock() {
  return process.env.SEND_MODE === 'mock' && process.env.META_CAMPAIGN_SEND_ENABLED !== 'true';
}
function selectedIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
}
function jobId(campaignId: string, contactId: string) {
  return `campaign-${campaignId}-contact-${contactId}`;
}

export async function enqueueCampaign(campaignId: string, tenantId: string) {
  if (!onlyMock()) throw Error('Mock mode required');
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, tenantId, status: 'DRAFT' },
  });
  if (!campaign) throw Error('Draft campaign unavailable');
  const ids = selectedIds(campaign.recipientIds);
  if (!ids.length) throw Error('Choose at least one opted-in contact');
  const validCount = await db.contact.count({
    where: { tenantId, consent: true, id: { in: ids } },
  });
  if (validCount !== ids.length) throw Error('Some selected contacts are no longer opted in');

  // Only one concurrent request can transition a draft to queued.
  const claimed = await db.campaign.updateMany({
    where: { id: campaignId, tenantId, status: 'DRAFT' },
    data: { status: 'QUEUED' },
  });
  if (claimed.count !== 1) throw Error('Campaign already started');

  try {
    for (const contactId of ids) {
      await campaignQueue.add(
        'mock-send',
        { campaignId, tenantId, contactId },
        { jobId: jobId(campaignId, contactId), attempts: 1 },
      );
    }
  } catch (error) {
    // Stop unfinished mock jobs if queue insertion fails.
    await db.campaign.updateMany({
      where: { id: campaignId, tenantId, status: 'QUEUED' },
      data: { status: 'FAILED' },
    });
    throw error;
  }
  return { queued: ids.length };
}

export async function getMockCampaignProgress(campaignId: string, tenantId: string) {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign) throw Error('Campaign not found');
  const ids = selectedIds(campaign.recipientIds);
  const counts = { queued: 0, active: 0, MOCK_SENT: 0, failed: 0, skipped: 0 };
  for (const id of ids) {
    const job = await campaignQueue.getJob(jobId(campaignId, id));
    if (!job) {
      counts.queued++; // A job may not yet have been enqueued.
      continue;
    }
    const state = await job.getState();
    if (state === 'completed') {
      if (job.returnvalue?.skipped) counts.skipped++;
      else counts.MOCK_SENT++;
    } else if (state === 'failed') counts.failed++;
    else if (state === 'active') counts.active++;
    else counts.queued++;
  }

  const remaining = counts.queued + counts.active;
  const terminal = counts.MOCK_SENT + counts.failed + counts.skipped;
  let status = campaign.status;
  if (status === 'QUEUED' && ids.length > 0 && remaining === 0 && terminal === ids.length) {
    const next = counts.failed || counts.skipped
      ? (counts.MOCK_SENT ? 'PARTIAL' : 'FAILED')
      : 'COMPLETED';
    const updated = await db.campaign.updateMany({
      where: { id: campaignId, tenantId, status: 'QUEUED' },
      data: { status: next },
    });
    if (updated.count) status = next;
  }
  return { campaignStatus: status, total: ids.length, counts };
}

export async function retryFailedMockCampaign(campaignId: string, tenantId: string) {
  if (!onlyMock()) throw Error('Mock mode required');
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, tenantId } });
  if (!campaign || !['FAILED', 'PARTIAL'].includes(campaign.status)) {
    throw Error('Only failed or partially completed campaigns can be retried');
  }
  const ids = selectedIds(campaign.recipientIds);
  const retryIds: string[] = [];
  for (const id of ids) {
    const job = await campaignQueue.getJob(jobId(campaignId, id));
    if (job && await job.getState() === 'failed') retryIds.push(id);
  }
  if (!retryIds.length) throw Error('No failed mock jobs to retry');
  const consented = await db.contact.findMany({
    where: { id: { in: retryIds }, tenantId, consent: true },
    select: { id: true },
  });
  const allowed = new Set(consented.map(c => c.id));
  const claimed = await db.campaign.updateMany({
    where: { id: campaignId, tenantId, status: { in: ['FAILED', 'PARTIAL'] } },
    data: { status: 'QUEUED' },
  });
  if (!claimed.count) throw Error('Campaign retry already started');
  for (const id of retryIds) {
    const job = await campaignQueue.getJob(jobId(campaignId, id));
    if (!job) continue;
    if (!allowed.has(id)) {
      // The worker will skip a contact whose consent has been revoked.
      await job.retry();
    } else await job.retry();
  }
  return { retried: retryIds.length };
}

export function startWorker() {
  if (!onlyMock()) throw Error('This worker is mock-only');
  const worker = new Worker(queueName, async (job: Job) => {
    if (!onlyMock()) throw Error('Worker is mock-only');
    const { campaignId, tenantId, contactId } = job.data;
    const [campaign, contact] = await Promise.all([
      db.campaign.findFirst({ where: { id: campaignId, tenantId } }),
      db.contact.findFirst({ where: { id: contactId, tenantId, consent: true } }),
    ]);
    if (!campaign || !contact || campaign.status !== 'QUEUED' ||
      !selectedIds(campaign.recipientIds).includes(contactId)) return { skipped: true };
    return new MockProvider().send({
      to: contact.phone, template: campaign.templateName, language: 'en_US',
    });
  }, { connection, concurrency: 2 });

  const reconcile = (job?: Job) => {
    const campaignId = job?.data?.campaignId;
    const tenantId = job?.data?.tenantId;
    if (typeof campaignId === 'string' && typeof tenantId === 'string') {
      void getMockCampaignProgress(campaignId, tenantId).catch(error =>
        console.error('Mock progress reconciliation failed', error));
    }
  };
  worker.on('completed', reconcile);
  worker.on('failed', reconcile);
  return worker;
}
