import {createHmac,timingSafeEqual} from 'node:crypto';
export function verifyMetaSignature(raw:Buffer,signature:string|undefined,secret:string){
 if(!signature?.startsWith('sha256=')||!secret)return false;
 const expected=createHmac('sha256',secret).update(raw).digest('hex');
 const supplied=signature.slice(7);
 if(!/^[a-f0-9]{64}$/i.test(supplied))return false;
 return timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(supplied,'hex'));
}
export function metaChallenge(mode:unknown,token:unknown,challenge:unknown,verifyToken:string){
 return mode==='subscribe'&&token===verifyToken&&typeof challenge==='string'?challenge:null;
}
