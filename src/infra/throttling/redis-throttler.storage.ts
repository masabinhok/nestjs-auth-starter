import type { OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';

/**
 * Fixed-window counter shared by every instance. One Lua script per hit, so
 * concurrent requests on different instances can't both slip under the limit.
 * Returns: hits, ms until the window resets, blocked (0/1), ms until unblocked.
 */
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

const INCREMENT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  return { limit + 1, redis.call('PTTL', hitsKey), 1, blockTtl }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttl)
end
local hitsTtl = redis.call('PTTL', hitsKey)

if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockDuration)
  return { hits, hitsTtl, 1, blockDuration }
end
return { hits, hitsTtl, 0, 0 }
`;

export class RedisThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly redis: Redis;

  constructor(
    url: string,
    private readonly prefix = 'throttle',
  ) {
    this.redis = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}:${throttlerName}:${key}`;
    const [hits, hitsTtl, blocked, blockTtl] = (await this.redis.eval(
      INCREMENT,
      2,
      `${base}:hits`,
      `${base}:blocked`,
      ttl,
      limit,
      blockDuration || ttl,
    )) as [number, number, number, number];

    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(hitsTtl / 1000)),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(blockTtl / 1000)),
    };
  }

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
