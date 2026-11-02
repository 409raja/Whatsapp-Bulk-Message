import { PrismaClient } from '@prisma/client';
import { verifyMetaSignature, metaChallenge } from './webhook';
const db=new PrismaClient();
const rank:Record<string,number>={ACCEPTED:1,SENT:2,DELIVERED:3,READ:4,FAILED:5};
export function normalizedDeliveryStatus(v:unknown):string|null{
 return typeof v==='string' && ['sent','delivered','read','failed'].includes(v)
  ?v.toUpperCase():null;
}
// Preserve a safe, bounded diagnostic from signed Meta delivery failures.
export function metaFailureDiagnostic(errors:unknown):string {
 if(!Array.isArray(errors)||errors.length===0)return 'Meta reported failed; no error details supplied';
 const first=errors[0];
 if(!first||typeof first!=='object')return 'Meta reported failed; invalid error details';
 const item=first as {code?:unknown;title?:unknown;message?:unknown};
 const code=typeof item.code==='number' && Number.isSafeInteger(item.code)?String(item.code):'unknown';
 // Do not persist arbitrary descriptions / error_data: they can contain recipient details.
 const title=typeof item.title==='string'?item.title.replace(/[\r\n\t]/g,' ').slice(0,120):'Delivery failed';
 return ('Meta error '+code+': '+title).slice(0,220);
}
export function liveWebhookGet(req:any,res:any){
 const token=process.env.META_WEBHOOK_VERIFY_TOKEN;
 if(!token)return res.sendStatus(503);
 const challenge=metaChallenge(req.query['hub.mode'],req.query['hub.verify_token'],req.query['hub.challenge'],token);
 return challenge===null?res.sendStatus(403):res.status(200).send(challenge);
}
export async function liveWebhookPost(req:any,res:any){
 const secret=process.env.META_APP_SECRET;
 if(!secret||!Buffer.isBuffer(req.body)||!verifyMetaSignature(req.body,req.get('x-hub-signature-256'),secret)){
  return res.sendStatus(403);
 }
 let payload:any;
 try{payload=JSON.parse(req.body.toString('utf8'))}catch{return res.sendStatus(400)}
 const updates:any[]=[];
 if(Array.isArray(payload.entry))for(const entry of payload.entry){
  if(!Array.isArray(entry.changes))continue;
  for(const change of entry.changes){
   const phoneId=change?.value?.metadata?.phone_number_id;
   if(typeof phoneId!=='string')continue;
   const connection=await db.whatsAppConnection.findFirst({where:{phoneNumberId:phoneId},select:{id:true,tenantId:true}});
   if(!connection)continue;
   if(Array.isArray(change?.value?.statuses))for(const status of change.value.statuses){
    const normalized=normalizedDeliveryStatus(status?.status);
    if(normalized && typeof status?.id==='string')updates.push({connection,normalized,messageId:status.id,diagnostic:normalized==='FAILED'?metaFailureDiagnostic(status.errors):null});
   }
  }
 }
 try{
  for(const item of updates){
   // Match both connection and Meta-assigned message ID; never match merely by recipient.
   const row=await db.liveCampaignDelivery.findFirst({where:{
    messageId:item.messageId,connectionId:item.connection.id,tenantId:item.connection.tenantId}});
   if(!row||!rank[item.normalized])continue;
   if((rank[row.status]||0)>rank[item.normalized])continue;
   await db.liveCampaignDelivery.updateMany({where:{id:row.id,status:row.status},data:{status:item.normalized,...(item.normalized==='FAILED'?{lastError:item.diagnostic}:{})}});
  }
  return res.sendStatus(200);
 }catch(error){console.error('Standalone live webhook persistence failed',error);return res.sendStatus(503)}
}
