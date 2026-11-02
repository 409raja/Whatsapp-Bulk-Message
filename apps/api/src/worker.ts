import 'dotenv/config';
import { startWorker } from './queue';

if (process.env.SEND_MODE !== 'mock' || process.env.META_CAMPAIGN_SEND_ENABLED === 'true') {
 throw new Error('This worker is for local mock-only testing');
}
const worker=startWorker();
worker.on('failed', (job,error)=>console.error('Mock job failed',job?.id,error.message));
console.log('Mock campaign worker started');
