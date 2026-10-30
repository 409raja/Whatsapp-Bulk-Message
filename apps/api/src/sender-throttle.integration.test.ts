import { describe, it, expect } from 'vitest';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { THROTTLE_LUA, senderThrottleKey } from './sender-throttle';

const suite = process.env.RUN_REDIS_INTEGRATION === '1' ? describe : describe.skip;
suite('Redis sender throttle integration', () => {
  it('admits exactly one of twelve concurrent calls', async () => {
    const queue = new Queue('throttle-integration-check', { connection: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      connectTimeout: 3000,
      maxRetriesPerRequest: 1,
    } });
    const key = senderThrottleKey('test_' + randomUUID().replaceAll('-', ''), 'mock-sender');
    try {
      const client = await queue.client as unknown as {
        eval: (lua: string, count: number, key: string, owner: string, ms: string) => Promise<number | string>;
        del: (key: string) => Promise<number>;
      };
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
        client.eval(THROTTLE_LUA, 1, key, String(i), '1500').then(Number)
      ));
      expect(results.filter(v => v === 0)).toHaveLength(1);
      expect(results.filter(v => v > 0 && v <= 1500)).toHaveLength(11);
    } finally {
      const client = await queue.client.catch(() => null);
      if (client) await client.del(key).catch(() => undefined);
      await queue.close();
    }
  }, 12000);
});