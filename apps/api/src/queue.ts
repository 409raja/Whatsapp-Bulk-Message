import {Queue,Worker,Job} from 'bullmq';
import {PrismaClient} from '@prisma/client';
import {MetaCloudProvider,MockProvider} from './provider';
const db=new PrismaClient();
const connection={host:process.env.REDIS_HOST||'127.0.0.1',port:Number(process.env.REDIS_PORT||6379)};
export const campaignQueue=new Queue('consented-campaigns',{connection});
export async function enqueueCampaign(campaignId:string,tenantId:string){
 const campaign=await db.campaign.findFirst({where:{id:campaignId,tenantId,status:'DRAFT'}});
 if(!campaign)throw Error('Campaign unavailable');
 const contacts=await db.contact.findMany({where:{tenantId,consent:true}});
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
  const provider=process.env.SEND_MODE==='meta'?new MetaCloudProvider(process.env.META_ACCESS_TOKEN||'',process.env.META_PHONE_NUMBER_ID||''):new MockProvider();
  // Production needs per-tenant provider credentials, persisted recipient ledger, and reconciliation before sending.
  if(process.env.SEND_MODE==='meta')throw Error('Real sending disabled until tenant credentials, recipient ledger and webhook reconciliation are implemented');
  return provider.send({to:contact.phone,template:campaign.templateName,language:'en_US'});
 },{connection,concurrency:2});
}
