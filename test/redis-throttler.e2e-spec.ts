import { randomUUID } from 'node:crypto';
import { RedisThrottlerStorage } from '../src/infra/throttling/redis-throttler.storage.js';

// Runs when a Redis is available (CI and docker compose set REDIS_URL).
const url = process.env.TEST_REDIS_URL;

describe.skipIf(!url)('RedisThrottlerStorage', () => {
  const storage = new RedisThrottlerStorage(url!, `test-${randomUUID()}`);
  afterAll(() => storage.onApplicationShutdown());

  it('counts hits within the window and blocks past the limit', async () => {
    const key = randomUUID();
    const hit = () => storage.increment(key, 60_000, 3, 30_000, 'default');
    expect((await hit()).totalHits).toBe(1);
    await hit();
    const third = await hit();
    expect(third).toMatchObject({ totalHits: 3, isBlocked: false });
    const fourth = await hit();
    expect(fourth.isBlocked).toBe(true);
    expect(fourth.timeToBlockExpire).toBe(30);
  });

  it('never lets concurrent hits slip under the limit', async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        storage.increment(key, 60_000, 5, 60_000, 'default'),
      ),
    );
    expect(results.filter((r) => !r.isBlocked)).toHaveLength(5);
  });
});
