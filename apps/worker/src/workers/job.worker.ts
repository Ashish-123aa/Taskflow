import { Worker, UnrecoverableError, type Job as BullJob } from 'bullmq';
import { JOB_QUEUE_NAME, prisma, type JobQueueData } from '@taskflow/shared';
import { redisConnection } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { getHandler } from '../jobs/registry';
import { NonRetryableJobError } from '../utils/errors';
import { publishJobEvent } from '../events/publisher';
import { notificationRepository } from '../repositories/notification.repository';

/**
 * One BullMQ Worker consuming the shared "jobs" queue, with configurable
 * concurrency (section 36: WORKER_CONCURRENCY) — this process pulls up to
 * that many jobs at once and runs their handlers concurrently, on top of
 * however many worker processes or containers are also running (each gets
 * its own Worker instance against the same queue — see
 * docs/scalability.md, added in the scaling phase).
 *
 * Every status/attempt transition described in section 8 lives here, in
 * one place, regardless of which handler runs — see
 * docs/worker-system.md ("What the worker does around every handler call").
 * As of Phase 6, this is also the one place that publishes real-time job
 * events and writes notifications — see docs/realtime.md.
 */
export function createJobWorker(): Worker<JobQueueData> {
  return new Worker<JobQueueData>(
    JOB_QUEUE_NAME,
    async (bullJob: BullJob<JobQueueData>) => {
      const { jobId } = bullJob.data;
      const job = await prisma.job.findUnique({ where: { id: jobId } });

      if (!job) {
        // The database row is gone (e.g. deleted after being queued) —
        // nothing to do, and not worth retrying.
        logger.warn('Queued job has no matching database row, skipping', { jobId });
        return;
      }

      const handler = getHandler(job.type);
      if (!handler) {
        // Should be unreachable in normal operation — createJobSchema
        // only accepts known types — but a handler could in principle be
        // un-registered independently of the type list, so this is
        // guarded rather than assumed.
        throw new Error(`No handler registered for job type "${job.type}"`);
      }

      // Two distinct counters, deliberately not conflated — see
      // docs/queue-system.md ("Two attempt counters, on purpose"):
      //
      // - `attemptNumber` is lifetime-cumulative, sourced from Postgres.
      //   It only ever goes up, including across a manual retry (which
      //   creates a brand-new BullMQ job instance). This is what
      //   JobAttempt rows are numbered by, so the job details timeline
      //   (section 22) never collides or resets after a manual retry.
      // - `cycleAttemptsMade` / `cycleMaxAttempts` describe THIS BullMQ
      //   job instance's own automatic retry budget, which legitimately
      //   *does* reset to 0 whenever a new instance is queued (a manual
      //   retry deliberately grants a fresh cycle — see
      //   jobService.retryJob). This is what decides whether THIS
      //   failure is terminal.
      const attemptNumber = job.attempts + 1;
      const cycleAttemptsMade = bullJob.attemptsMade;
      const cycleMaxAttempts = bullJob.opts.attempts ?? job.maxAttempts;

      await prisma.$transaction([
        prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'RUNNING',
            startedAt: job.startedAt ?? new Date(),
            attempts: attemptNumber,
          },
        }),
        prisma.jobAttempt.create({
          data: { jobId: job.id, attemptNumber, status: 'RUNNING' },
        }),
      ]);

      logger.info('Job started', { jobId: job.id, type: job.type, attempt: attemptNumber });
      void publishJobEvent({ jobId: job.id, userId: job.userId, type: 'job:started', status: 'RUNNING' });

      const attemptStart = Date.now();

      try {
        const result = await handler.execute({
          jobId: job.id,
          userId: job.userId,
          payload: job.payload as Record<string, unknown>,
          attempt: attemptNumber,
          updateProgress: async (percent: number) => {
            await prisma.job.update({ where: { id: job.id }, data: { progress: percent } });
            await bullJob.updateProgress(percent);
            void publishJobEvent({
              jobId: job.id,
              userId: job.userId,
              type: 'job:progress',
              status: 'RUNNING',
              progress: percent,
            });
          },
        });

        await prisma.$transaction([
          prisma.job.update({
            where: { id: job.id },
            data: {
              status: 'COMPLETED',
              result: result as object,
              progress: 100,
              completedAt: new Date(),
            },
          }),
          prisma.jobAttempt.updateMany({
            where: { jobId: job.id, attemptNumber },
            data: {
              status: 'SUCCEEDED',
              completedAt: new Date(),
              duration: Date.now() - attemptStart,
            },
          }),
        ]);

        logger.info('Job completed', { jobId: job.id, durationMs: Date.now() - attemptStart });
        void publishJobEvent({
          jobId: job.id,
          userId: job.userId,
          type: 'job:completed',
          status: 'COMPLETED',
          progress: 100,
        });
        void notificationRepository.create({
          userId: job.userId,
          jobId: job.id,
          type: 'JOB_COMPLETED',
          message: `Job "${job.name}" completed successfully.`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const nonRetryable = err instanceof NonRetryableJobError;
        const cycleExhausted = cycleAttemptsMade + 1 >= cycleMaxAttempts;
        const isTerminal = nonRetryable || cycleExhausted;

        // Three distinct terminal-ish outcomes — see docs/worker-system.md
        // ("FAILED vs. RETRYING vs. DEAD_LETTER") for the full reasoning.
        let finalStatus: 'RETRYING' | 'FAILED' | 'DEAD_LETTER';
        if (!isTerminal) {
          finalStatus = 'RETRYING';
        } else if (nonRetryable || cycleMaxAttempts <= 1) {
          finalStatus = 'FAILED';
        } else {
          finalStatus = 'DEAD_LETTER';
        }

        await prisma.$transaction([
          prisma.job.update({
            where: { id: job.id },
            data: {
              status: finalStatus,
              error: message,
              ...(finalStatus !== 'RETRYING' ? { failedAt: new Date() } : {}),
            },
          }),
          prisma.jobAttempt.updateMany({
            where: { jobId: job.id, attemptNumber },
            data: {
              status: 'FAILED',
              completedAt: new Date(),
              error: message,
              duration: Date.now() - attemptStart,
            },
          }),
        ]);

        logger.warn(`Job attempt failed (${finalStatus})`, {
          jobId: job.id,
          attempt: attemptNumber,
          cycleAttemptsMade,
          cycleMaxAttempts,
          error: message,
          nonRetryable,
        });

        // job:retrying / job:failed / job:dead_letter map 1:1 onto
        // finalStatus — see packages/shared/src/events/job-events.ts.
        const eventType =
          finalStatus === 'RETRYING'
            ? 'job:retrying'
            : finalStatus === 'DEAD_LETTER'
              ? 'job:dead_letter'
              : 'job:failed';
        void publishJobEvent({
          jobId: job.id,
          userId: job.userId,
          type: eventType,
          status: finalStatus,
          error: message,
        });

        // A notification (section 24) only for the two states a person
        // actually needs to act on or be told about — not for RETRYING,
        // which is routine and will either resolve itself or eventually
        // become one of the other two.
        if (finalStatus === 'FAILED') {
          void notificationRepository.create({
            userId: job.userId,
            jobId: job.id,
            type: 'JOB_FAILED',
            message: `Job "${job.name}" failed: ${message}`,
          });
        } else if (finalStatus === 'DEAD_LETTER') {
          void notificationRepository.create({
            userId: job.userId,
            jobId: job.id,
            type: 'JOB_DEAD_LETTER',
            message: `Job "${job.name}" failed after ${cycleMaxAttempts} attempt(s) and was moved to the dead-letter queue.`,
          });
        }

        if (nonRetryable) {
          // BullMQ's own escape hatch: tells it to stop immediately,
          // ignoring this cycle's configured `attempts` entirely.
          throw new UnrecoverableError(message);
        }

        // Re-throw so BullMQ's own retry/backoff (configured when this
        // job instance was added to the queue) schedules the next
        // attempt automatically — this worker never manually re-queues a
        // failed job itself.
        throw err;
      }
    },
    {
      connection: redisConnection,
      concurrency: env.WORKER_CONCURRENCY,
    },
  );
}
