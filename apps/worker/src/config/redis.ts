import { createRedisConnection } from '@taskflow/shared';
import { env } from './env';

// BullMQ's Worker holds this connection for blocking operations
// internally. Nothing else should share it — see redisPublisher below.
export const redisConnection = createRedisConnection(env.REDIS_URL);

// A second, dedicated connection for publishing job events. Sharing the
// Worker's own connection for this would mean our PUBLISH calls could
// get stuck queued behind whatever blocking command BullMQ currently has
// in flight on that connection — a real-time update arriving late
// defeats the point of it being real-time. See docs/realtime.md ("Why
// every process gets its own dedicated pub/sub connection").
export const redisPublisher = createRedisConnection(env.REDIS_URL);
