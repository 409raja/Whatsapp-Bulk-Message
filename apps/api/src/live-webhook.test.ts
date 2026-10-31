import {describe,it,expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {verifyMetaSignature,metaChallenge} from './webhook';
import {normalizedDeliveryStatus,metaFailureDiagnostic} from './live-webhook';

describe('Meta webhook safety',()=>{
 it('rejects tampered or untrusted signatures',()=>{
  const body=Buffer.from('{"test":true}');
  const sig='sha256='+createHmac('sha256','secret').update(body).digest('hex');
  expect(verifyMetaSignature(body,sig,'secret')).toBe(true);
  expect(verifyMetaSignature(Buffer.from('{}'),sig,'secret')).toBe(false);
 });
 it('requires matching webhook challenge secret',()=>{
  expect(metaChallenge('subscribe','pass','123','pass')).toBe('123');
  expect(metaChallenge('subscribe','wrong','123','pass')).toBeNull();
 });
 it('captures only safe Meta failure code and title for investigation',()=>{
  expect(metaFailureDiagnostic([{code:131026,title:'Message undeliverable',error_data:{details:'private number'}}])).toBe('Meta error 131026: Message undeliverable');
  expect(metaFailureDiagnostic([])).toMatch(/no error details supplied/);
  expect(metaFailureDiagnostic([{code:130429,title:'Rate limit\\nblocked'}])).toBe('Meta error 130429: Rate limit blocked');
 });
 it('only maps supported delivery states',()=>{
  expect(normalizedDeliveryStatus('delivered')).toBe('DELIVERED');
  expect(normalizedDeliveryStatus('read')).toBe('READ');
  expect(normalizedDeliveryStatus('unknown')).toBeNull();
 });
});
