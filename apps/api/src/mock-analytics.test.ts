import {describe,expect,it} from 'vitest';
import {aggregateMockStats} from './mock-analytics';

describe('mock analytics totals',()=>{
 it('sums multiple campaign statuses without suggesting real delivery',()=>{
  const result=aggregateMockStats(
   [{status:'COMPLETED',_count:{_all:3}},{status:'PARTIAL',_count:{_all:2}}],
   [{status:'MOCK_SENT',_count:{_all:99}},{status:'FAILED',_count:{_all:1}}]
  );
  expect(result.mode).toBe('MOCK_ONLY');
  expect(result.campaigns.total).toBe(5);
  expect(result.campaigns.completed).toBe(3);
  expect(result.deliveries.mockSent).toBe(99);
  expect(result.deliveries.failed).toBe(1);
 });
 it('returns zero for missing statuses',()=>{
  const result=aggregateMockStats([],[]);
  expect(result.deliveries.mockSent).toBe(0);
  expect(result.campaigns.queued).toBe(0);
 });
});
