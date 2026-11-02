export type SendRequest={to:string;template:string;language:string;components?:unknown[]};
export interface MessageProvider{send(input:SendRequest):Promise<{id:string}>}
export class MetaApiError extends Error {
 constructor(public readonly code:number|undefined){
  super(code===130429?'Meta rate limit hit (130429)':'Meta rejected message');
  this.name='MetaApiError';
 }
}
export class MetaCloudProvider implements MessageProvider {
 constructor(private token:string,private phoneNumberId:string,private version='v23.0'){}
 async send(input:SendRequest){
  const response=await fetch('https://graph.facebook.com/'+this.version+'/'+this.phoneNumberId+'/messages',{
   method:'POST',headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},
   body:JSON.stringify({messaging_product:'whatsapp',to:input.to,type:'template',template:{
    name:input.template,language:{code:input.language},components:input.components||[]
   }}),signal:AbortSignal.timeout(15000)
  });
  const body:any=await response.json();
  if(!response.ok||!body.messages?.[0]?.id){
   const code=typeof body?.error?.code==='number'?body.error.code:undefined;
   // Never expose Meta response details, tokens or recipient data to log output.
   throw new MetaApiError(code);
  }
  return {id:body.messages[0].id as string};
 }
}
export class MockProvider implements MessageProvider {
 async send(_input:SendRequest){return {id:'mock-'+crypto.randomUUID()}}
}
