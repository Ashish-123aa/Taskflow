import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { JOB_EVENTS_CHANNEL, type JobEventPayload } from '@taskflow/shared';
import { env } from '../config/env';
import { redisSubscriber } from '../config/redis';
import { verifyToken } from '../services/token.service';
import { dashboardStatsCache } from '../services/dashboardCache';
import { logger } from '../config/logger';
import { extractTokenFromCookieHeader } from './cookie';

/**
 * Wires up the Socket.IO server and bridges it to the Redis channel the
 * worker (and this API process itself, for API-originated events like
 * job:queued) publishes job events to. Called once from src/index.ts,
 * after the HTTP server exists — Socket.IO attaches to an existing HTTP
 * server rather than opening its own port, so the WebSocket upgrade
 * happens on the same host:port the REST API already listens on. See
 * docs/realtime.md for the full design.
 */
export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: env.CLIENT_URL, credentials: true },
  });

  // A WebSocket connection needs the same authentication boundary an
  // HTTP request does — without this, any client could open a socket and
  // receive every job's real-time updates for free, regardless of who
  // owns them.
  io.use((socket, next) => {
    const token = extractTokenFromCookieHeader(socket.handshake.headers.cookie);
    if (!token) {
      next(new Error('Authentication required'));
      return;
    }
    try {
      const payload = verifyToken(token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('Invalid or expired session'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    // Each user gets their own room. A job event is only ever emitted
    // into the room of the user who owns that job (see the subscriber
    // below), so a browser tab never receives another user's job
    // updates — the same ownership boundary the REST API enforces,
    // enforced here too rather than trusted to the frontend to filter.
    void socket.join(`user:${userId}`);
    logger.info('WebSocket client connected', { userId, socketId: socket.id });

    socket.on('disconnect', () => {
      logger.info('WebSocket client disconnected', { userId, socketId: socket.id });
    });
  });

  redisSubscriber.subscribe(JOB_EVENTS_CHANNEL, (err) => {
    if (err) {
      logger.error('Failed to subscribe to job events channel', { error: err });
    }
  });

  redisSubscriber.on('message', (channel, message) => {
    if (channel !== JOB_EVENTS_CHANNEL) return;
    try {
      const event = JSON.parse(message) as JobEventPayload;
      io.to(`user:${event.userId}`).emit(event.type, event);

      // Phase 9.3 — this subscriber is the one place in the API process
      // that hears about *every* job-status transition, whether it
      // originated in the worker (started/completed/failed/retrying/
      // dead_letter) or in the API itself (queued/cancelled), so it's
      // where the owner's cached dashboard stats get invalidated —
      // rather than scattering invalidation calls through every code
      // path that can change a job's status. job:progress is excluded:
      // a progress tick never changes any aggregate the dashboard
      // shows (counts by status/type, success rate, durations), and
      // invalidating on every one would defeat the cache entirely for
      // anyone with a long-running job open.
      if (event.type !== 'job:progress') {
        void dashboardStatsCache.invalidate(event.userId);
      }
    } catch (err) {
      logger.error('Failed to parse job event from Redis', { error: err, raw: message });
    }
  });

  return io;
}
