/**
 * Standalone synthetic BullMQ benchmark. No Prisma, campaign DB, recipient phones,
 * credentials, or Meta APIs are used. Requires a local Redis instance.
 *
 * Run: npm run test:mock-load -w apps/api
 */
import 'dotenv/config';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { MockProvider } from './provider';

const sizes = [100, 500, 1000] as const;
const host = process.env.REDIS_HOST || '127.0.0.1';
const port = Number(process.env.REDIS_PORT || 6379);
const connection = { host, port, maxRetriesPerRequest: null as null };
const name = 'mock-load-' + randomUUID().replace(/-/g, '');
const queue = new Queue(name, { connection });
const events = new QueueEvents(name, { connection });
const worker = new Worker(name, async job => {
  const n: number = job.data.index;
  if (!Number.isInteger(n) || n < 0 || n >= 1000) throw Error('Invalid synthetic job index');
  // Deliberately use non-phone synthetic identifiers; mock only.
  return new MockProvider().send({
    to: 'synthetic-contact-' + n,
    template: 'load_test_only',
    language: 'en_US',
  });
}, { connection, concurrency: 20 });

async function runBatch(size: number) {
 const id = randomUUID();
 let succeeded = 0;
 let failed = 0;
 const latencies: number[] = [];
 const jobs = Array.from({ length: size }, (_, index) => ({
  name: 'synthetic-mock',
  data: { index, batch: id },
  opts: { jobId: `batch-${id}-${index}`, attempts: 1 },
 }));
 const started = performance.now();
 await queue.addBulk(jobs);
 // QueueEvents are ready before awaiting job completions.
 // Bounded waiting prevents hundreds of simultaneous EventEmitter listeners.
 // Using chunks also bounds Redis requests without altering the synthetic job volume.
 for (let offset = 0; offset < jobs.length; offset += 8) {
  const chunk = jobs.slice(offset, offset + 8);
  const results = await Promise.allSettled(chunk.map(async j => {
   const job = await queue.getJob(j.opts.jobId);
   if (!job) throw Error('Missing synthetic queue job');
   const t = performance.now();
   const value = await job.waitUntilFinished(events, 120000);
   if (!value?.id?.startsWith('mock-')) throw Error('Unexpected mock result');
   latencies.push(performance.now()-t);
  }));
  for (const r of results) if (r.status === 'fulfilled') succeeded++; else failed++;
 }
 latencies.sort((a,b)=>a-b);
 const elapsedMs = performance.now()-started;
 const p95Ms = latencies.length ? latencies[Math.min(latencies.length-1,Math.ceil(latencies.length*.95)-1)] : 0;
 console.log(JSON.stringify({ size, succeeded, failed, elapsedMs: Math.round(elapsedMs), throughputPerSec: Number((size/(elapsedMs/1000)).toFixed(1)), p95Ms: Math.round(p95Ms) }));
 if (failed) throw Error(`${failed} synthetic mock jobs failed`);
}

async function main() {
 if (process.env.SEND_MODE !== 'mock' || process.env.META_CAMPAIGN_SEND_ENABLED === 'true') {
  throw Error('Refusing load test unless SEND_MODE=mock and live sending is disabled');
 }
 try {
  await events.waitUntilReady();
  await worker.waitUntilReady();
  for (const size of sizes) await runBatch(size);
 } finally {
  await worker.close();
  await events.close();
  await queue.obliterate({ force:true });
  await queue.close();
 }
}
main().catch(err => { console.error(err);process.exitCode=1; });
