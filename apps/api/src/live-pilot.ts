import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import { decryptToken } from './encryption';
import { MetaCloudProvider } from './provider';

const db=new PrismaClient();
const redis={host:process.env.REDIS_HOST||'127.0.0.1',port:Number(process.env.REDIS_PORT||6379)};
export const liveQueue=new Queue('standalone-live-pilot',{connection:redis});
export const liveEnabled=()=>process.env.SEND_MODE==='live' && process.env.META_CAMPAIGN_SEND_ENABLED==='true'
  && process.env.LIVE_PILOT_ENABLED==='true';
const key=(campaignId:string,contactId:string)=>'live-'+campaignId+'-'+contactId;
const safeIds=(x:unknown):string[]=>Array.isArray(x)?[...new Set(x.filter((v):v is string=>typeof v==='string'))]:[];

export async function startLivePilot(campaignId:string,tenantId:string){
 if(!liveEnabled()) throw new Error('Live pilot disabled');
 const campaign=await db.campaign.findFirst({where:{id:campaignId,tenantId,status:'DRAFT'}});
 if(!campaign||!campaign.connectionId||!campaign.templateLanguage) throw new Error('Live campaign configuration missing');
 const recipients=safeIds(campaign.recipientIds);
 if(!recipients.length||recipients.length>2) throw new Error('Pilot allows 1-2 consenting contacts only');
 const count=await db.contact.count({where:{id:{in:recipients},tenantId,consent:true}});
 if(count!==recipients.length) throw new Error('Recipient consent changed');
 const connection=await db.whatsAppConnection.findFirst({where:{id:campaign.connectionId,tenantId,status:'ACTIVE'}});
 if(!connection||!connection.accessTokenEncrypted) throw new Error('Verified active connection required');
 const claimed=await db.campaign.updateMany({where:{id:campaignId,tenantId,status:'DRAFT'},data:{status:'QUEUED'}});
 if(claimed.count!==1) throw new Error('Pilot already started');
 await db.liveCampaignDelivery.createMany({
  data:recipients.map(contactId=>({campaignId,tenantId,contactId,connectionId:connection.id,status:'QUEUED'})),
  skipDuplicates:true
 });
 await recoverLivePilot(campaignId,tenantId);
 return {queued:recipients.length,mode:'LIVE_PILOT',caution:'Meta API acceptance is not delivery confirmation'};
}

export async function recoverLivePilot(campaignId:string,tenantId:string){
 if(!liveEnabled()) return;
 const pending=await db.liveCampaignDelivery.findMany({where:{campaignId,tenantId,status:'QUEUED'}});
 for(let i=0;i<pending.length;i++){
  const d=pending[i]; const id=key(d.campaignId,d.contactId);
  if(!await liveQueue.getJob(id)) await liveQueue.add('live-template',{deliveryId:d.id,tenantId},
    {jobId:id,attempts:1,delay:i*3000,removeOnComplete:false,removeOnFail:false});
 }
}
export async function liveProgress(campaignId:string,tenantId:string){
 const c=await db.campaign.findFirst({where:{id:campaignId,tenantId},select:{id:true}});
 if(!c) throw new Error('Campaign not found');
 const deliveries=await db.liveCampaignDelivery.findMany({
  where:{campaignId,tenantId},select:{contactId:true,status:true,attempts:true,messageId:true,lastError:true},
  orderBy:{createdAt:'asc'},take:100
 });
 return {mode:'LIVE',deliveries};
}

export function startLiveWorker(){
 if(!liveEnabled()) throw new Error('Explicit live pilot enablement required');
 const worker=new Worker('standalone-live-pilot',async job=>{
  const delivery=await db.liveCampaignDelivery.findFirst({where:{id:job.data.deliveryId,tenantId:job.data.tenantId}});
  if(!delivery||delivery.status!=='QUEUED') return {skipped:true};
  const claimed=await db.liveCampaignDelivery.updateMany({where:{id:delivery.id,status:'QUEUED'},data:{status:'PROCESSING',attempts:{increment:1}}});
  if(claimed.count!==1) return {skipped:true};
  try{
   const [campaign,contact,connection]=await Promise.all([
    db.campaign.findFirst({where:{id:delivery.campaignId,tenantId:delivery.tenantId,status:'QUEUED'}}),
    db.contact.findFirst({where:{id:delivery.contactId,tenantId:delivery.tenantId,consent:true}}),
    db.whatsAppConnection.findFirst({where:{id:delivery.connectionId,tenantId:delivery.tenantId,status:'ACTIVE'}})
   ]);
   if(!campaign||!contact||!connection?.accessTokenEncrypted||campaign.connectionId!==connection.id||
       !campaign.templateLanguage||!safeIds(campaign.recipientIds).includes(contact.id)){
    await db.liveCampaignDelivery.update({where:{id:delivery.id},data:{status:'SKIPPED',lastError:'Not eligible at dispatch'}});
    return {skipped:true};
   }
   const token=decryptToken(connection.accessTokenEncrypted);
   const provider=new MetaCloudProvider(token,connection.phoneNumberId,process.env.META_GRAPH_VERSION||'v23.0');
   const result=await provider.send({to:contact.phone,template:campaign.templateName,
    language:campaign.templateLanguage,components:Array.isArray(campaign.templateComponents)?campaign.templateComponents as unknown[]:[]});
   await db.liveCampaignDelivery.update({where:{id:delivery.id},data:{status:'ACCEPTED',messageId:result.id,lastError:null}});
   return {accepted:true};
  }catch(error){
   // Unknown network outcome must never be retried automatically: Meta may have accepted it.
   await db.liveCampaignDelivery.update({where:{id:delivery.id},data:{
    status:'UNKNOWN',lastError:error instanceof Error?error.message.slice(0,300):'Live send outcome unknown'
   }});
   return {unknown:true};
  }
 },{connection:redis,concurrency:1,limiter:{max:1,duration:3000}});
 worker.on('failed',(job,error)=>console.error('Live worker local failure',job?.id,error.message));
 return worker;
}
