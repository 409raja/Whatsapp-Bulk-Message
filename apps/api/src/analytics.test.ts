import {describe,it,expect} from 'vitest';
import {metaChallenge,verifyMetaSignature} from './webhook';
import {createHmac} from 'node:crypto';
import {canCreateCampaign} from './billing';
describe('compliance foundations',()=>{
 it('verifies Meta webhook signature',()=>{
 const body=Buffer.from('{"hello":"world"}');const secret='test-secret';
 const signature='sha256='+createHmac('sha256',secret).update(body).digest('hex');
 expect(verifyMetaSignature(body,signature,secret)).toBe(true);
 expect(verifyMetaSignature(Buffer.from('changed'),signature,secret)).toBe(false);
 });
 it('checks subscription challenge',()=>{expect(metaChallenge('subscribe','correct','123','correct')).toBe('123');expect(metaChallenge('subscribe','wrong','123','correct')).toBeNull()});
 it('applies plan limits',()=>{expect(canCreateCampaign('TRIAL',1)).toBe(true);expect(canCreateCampaign('TRIAL',2)).toBe(false)});
});
