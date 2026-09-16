import IORedis from 'ioredis';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on any connection used for
 * its blocking operations. Centralizing connection creation here means
 * both the API (producer) and the worker (consumer) get this right by
 * construction, instead of each independently having to remember BullMQ's
 * own connection requirement.
 */
export function createRedisConnection(redisUrl: string): IORedis {
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}
