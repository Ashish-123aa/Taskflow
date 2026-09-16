import { createRedisConnection } from '@taskflow/shared';
import { env } from './env';

// Used for the BullMQ Queue (producer side — doesn't hold long blocking
// commands the way a Worker's connection does) and for the health check
// ping. Also fine to reuse for publishing job events (PUBLISH is a quick,
// non-blocking command), so it's exported for exactly that.
export const redisConnection = createRedisConnection(env.REDIS_URL);

// A dedicated connection for subscribing to job events. This CANNOT share
// a connection with anything else: once a Redis client issues SUBSCRIBE,
// that connection can only be used for pub/sub commands until it
// unsubscribes — trying to also run BullMQ or health-check commands on it
// would break both. See docs/realtime.md ("Why every process gets its
// own dedicated pub/sub connection").
export const redisSubscriber = createRedisConnection(env.REDIS_URL);
