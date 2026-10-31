import 'dotenv/config';
import {Queue,Worker,Job} from 'bullmq';
import {PrismaClient} from '@prisma/client';
import {MetaCloudProvider,MockProvider} from './provider';
const db=new PrismaClient();
const connection={host:process.env.REDIS_HOST||'127.0.0.1',port:Number(process.env.REDIS_PORT||6379)};
export const campaignQueue=new Queue('consented-campaigns',{connection});
export async function enqueueCampaign(campaignId:string,tenantId:string){
 const campaign=await db.campaign.findFirst({where:{id:campaignId,tenantId,status:'DRAFT'}});
 if(!campaign)throw Error('Campaign unavailable');
 const ids = Array.isArray(campaign.recipientIds) ? [...new Set(campaign.recipientIds.filter((id:unknown):id is string => typeof id === 'string'))] : [];
 if (!ids.length) throw Error('Campaign has no selected contacts');
 const contacts=await db.contact.findMany({where:{tenantId,consent:true,id:{in:ids}}});
 if (contacts.length !== ids.length) throw Error('Selected contacts must belong to this company and remain opted in');
 if(!contacts.length)throw Error('No opted-in contacts');
 await db.campaign.update({where:{id:campaignId},data:{status:'QUEUED'}});
 for(const contact of contacts)await campaignQueue.add('send',{campaignId,tenantId,contactId:contact.id},{jobId:`campaign-${campaignId}-contact-${contact.id}`,attempts:1});
 return {queued:contacts.length};
}
export function startWorker(){
 return new Worker('consented-campaigns',async(job:Job)=>{
  const {campaignId,tenantId,contactId}=job.data;
  const [campaign,contact]=await Promise.all([db.campaign.findFirst({where:{id:campaignId,tenantId}}),db.contact.findFirst({where:{id:contactId,tenantId,consent:true}})]);
  if(!campaign||!contact||campaign.status!=='QUEUED')return {skipped:true};
  const provider = new MockProvider();
  // Production needs per-tenant provider credentials, persisted recipient ledger, and reconciliation before sending.
  if(process.env.SEND_MODE!=='mock' || process.env.META_CAMPAIGN_SEND_ENABLED==='true')throw Error('Worker is mock-only');
  return provider.send({to:contact.phone,template:campaign.templateName,language:'en_US'});
 },{connection,concurrency:2});
}

export async function getMockCampaignProgress(campaignId: string, tenantId: string) {
 const campaign = await db.campaign.findFirst({ where: {id:campaignId, tenantId} });
 if (!campaign) throw Error('Campaign not found');
 const ids = Array.isArray(campaign.recipientIds) ? campaign.recipientIds.filter((id:unknown):id is string => typeof id==='string') : [];
 const counts = { queued:0, active:0, MOCK_SENT:0, failed:0, skipped:0 };
 for (const id of ids) {
  const job=await campaignQueue.getJob(`campaign-${campaignId}-contact-${id}`);
  if (!job) { counts.skipped++; continue; }
  const state=await job.getState();
  if (state==='completed') {
   if (job.returnvalue?.skipped) counts.skipped++;
   else counts.MOCK_SENT++;
  } else if (state==='failed') counts.failed++;
  else if (state==='active') counts.active++;
  else counts.queued++;
 }
 return {campaignStatus:campaign.status,total:ids.length,counts};
}
