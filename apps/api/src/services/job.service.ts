import { toBullMQPriority, JOB_PAYLOAD_SCHEMAS, type CreateJobInput, type Role } from '@taskflow/shared';
import { jobRepository, type JobListFilters } from '../repositories/job.repository';
import { auditLogRepository } from '../repositories/audit.repository';
import { jobQueue } from '../queues/job.queue';
import { publishJobEvent } from '../events/publisher';
import { ForbiddenError, NotFoundError, ConflictError } from '../utils/errors';
import { logger } from '../config/logger';

interface CreateJobParams extends CreateJobInput {
  userId: string;
}

interface Requester {
  id: string;
  role: Role;
}

interface RetryOptions {
  maxAttempts?: number;
}

const CANCELLABLE_STATUSES = ['PENDING', 'QUEUED'];
const RETRYABLE_STATUSES = ['FAILED', 'DEAD_LETTER'];

// Not a jobService method — a standalone function, so it can never
// accidentally be called detached from `this` (e.g. if a controller ever
// destructures `const { getJob } = jobService`).
function assertOwnership(job: { userId: string }, requester: Requester): void {
  if (requester.role !== 'ADMIN' && job.userId !== requester.id) {
    throw new ForbiddenError('You do not have access to this job');
  }
}

// True only for a *genuine* admin override — an admin acting on their own
// job doesn't need an audit trail any more than a regular user would.
function isAdminOverride(job: { userId: string }, requester: Requester): boolean {
  return requester.role === 'ADMIN' && job.userId !== requester.id;
}

export const jobService = {
  async createJob(params: CreateJobParams) {
    // Validate the payload against this specific job type's schema — the
    // generic envelope (name/type/priority/payload shape) was already
    // checked by createJobSchema in the controller; this is the second,
    // stricter layer: does an API_REQUEST payload actually have a valid
    // url, does an EMAIL payload have a real recipient. A ZodError thrown
    // here is caught by the same global error handler as any other
    // validation failure (see middleware/errorHandler.ts).
    const validatedPayload = JOB_PAYLOAD_SCHEMAS[params.type].parse(params.payload);

    // 1. Persist first. The database row is the source of truth — if the
    //    enqueue step below fails, there's still a durable PENDING record
    //    instead of a job that only ever existed transiently in Redis.
    const job = await jobRepository.create({
      user: { connect: { id: params.userId } },
      type: params.type,
      name: params.name,
      priority: params.priority,
      payload: validatedPayload as object,
      status: 'PENDING',
      ...(params.scheduledAt ? { scheduledAt: params.scheduledAt } : {}),
      // Falls back to the schema's own @default(3) when not provided —
      // see section 12 ("configurable retries") and docs/queue-system.md.
      ...(params.maxAttempts ? { maxAttempts: params.maxAttempts } : {}),
    });

    // 2. Hand it to the queue. Only { jobId, type } goes on the queue —
    //    see docs/queue-system.md for why the payload itself doesn't.
    await jobQueue.add(
      job.type,
      { jobId: job.id, type: job.type as CreateJobInput['type'] },
      {
        priority: toBullMQPriority(job.priority as CreateJobInput['priority']),
        attempts: job.maxAttempts,
        backoff: { type: 'exponential', delay: 2000 },
        delay: params.scheduledAt
          ? Math.max(0, params.scheduledAt.getTime() - Date.now())
          : undefined,
      },
    );

    const queued = await jobRepository.update(job.id, { status: 'QUEUED' });
    logger.info('Job created and queued', { jobId: job.id, type: job.type, userId: params.userId });

    // Fire-and-forget (see events/publisher.ts) — the HTTP response
    // doesn't wait on this, and a missed real-time update never blocks
    // job creation itself.
    void publishJobEvent({ jobId: job.id, userId: params.userId, type: 'job:queued', status: 'QUEUED' });

    return queued;
  },

  async getJob(jobId: string, requester: Requester) {
    const job = await jobRepository.findById(jobId);
    if (!job) throw new NotFoundError('Job');
    assertOwnership(job, requester);
    return job;
  },

  async listJobs(requester: Requester, filters: Omit<JobListFilters, 'userId'>) {
    // Always scoped to the requester's own jobs — including for admins.
    // An admin's *global* view across every user's jobs lives at
    // GET /api/v1/admin/jobs (adminService.listAllJobs), a deliberately
    // separate endpoint rather than a role-based branch here, so "my
    // jobs" means the same thing for every account and the two views
    // can't accidentally bleed into each other — see docs/admin.md.
    return jobRepository.findMany({ ...filters, userId: requester.id });
  },

  async cancelJob(jobId: string, requester: Requester) {
    const job = await jobRepository.findById(jobId);
    if (!job) throw new NotFoundError('Job');
    assertOwnership(job, requester);

    if (!CANCELLABLE_STATUSES.includes(job.status)) {
      throw new ConflictError(
        `Cannot cancel a job with status ${job.status}. Only PENDING or QUEUED jobs can be cancelled — a RUNNING job can only be cancelled if its handler supports cancellation (not yet implemented for any handler).`,
      );
    }

    // Best-effort removal from BullMQ. If the job already started running
    // between the status check above and this call, `.remove()` simply
    // won't find it — that's fine, the status check already prevented
    // cancelling a genuinely RUNNING job.
    const bullJob = await jobQueue.getJob(job.id);
    await bullJob?.remove();

    const cancelled = await jobRepository.update(job.id, { status: 'CANCELLED' });

    if (isAdminOverride(job, requester)) {
      await auditLogRepository.record({
        userId: requester.id,
        action: 'ADMIN_JOB_CANCEL',
        resource: 'Job',
        resourceId: job.id,
        metadata: { originalOwnerId: job.userId },
      });
    }

    logger.info('Job cancelled', { jobId: job.id, userId: requester.id });
    void publishJobEvent({ jobId: job.id, userId: job.userId, type: 'job:cancelled', status: 'CANCELLED' });
    return cancelled;
  },

  async retryJob(jobId: string, requester: Requester, options: RetryOptions = {}) {
    const job = await jobRepository.findById(jobId);
    if (!job) throw new NotFoundError('Job');
    assertOwnership(job, requester);

    if (!RETRYABLE_STATUSES.includes(job.status)) {
      throw new ConflictError(
        `Cannot retry a job with status ${job.status}. Only FAILED or DEAD_LETTER jobs can be retried.`,
      );
    }

    // A manual retry grants a *fresh* attempts cycle, not an extension of
    // the exhausted one — see docs/queue-system.md ("Manual retries: a
    // fresh cycle, not an extension") for the full reasoning. If an
    // override is given, it becomes the new ceiling for this fresh cycle.
    const cycleMaxAttempts = options.maxAttempts ?? job.maxAttempts;

    await jobQueue.add(
      job.type,
      { jobId: job.id, type: job.type as CreateJobInput['type'] },
      {
        priority: toBullMQPriority(job.priority as CreateJobInput['priority']),
        attempts: cycleMaxAttempts,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    const retried = await jobRepository.update(job.id, {
      status: 'QUEUED',
      error: null,
      maxAttempts: cycleMaxAttempts,
    });

    if (isAdminOverride(job, requester)) {
      await auditLogRepository.record({
        userId: requester.id,
        action: 'ADMIN_JOB_RETRY',
        resource: 'Job',
        resourceId: job.id,
        metadata: { originalOwnerId: job.userId, newMaxAttempts: cycleMaxAttempts },
      });
    }

    logger.info('Job manually retried', {
      jobId: job.id,
      userId: requester.id,
      newMaxAttempts: cycleMaxAttempts,
    });
    // Uses 'job:queued' (not a distinct "job:manually-retried" type) — a
    // manual retry puts the job back in exactly the state a brand-new job
    // starts in, and the frontend's handling of "this job just got
    // queued" doesn't need to know whether it's the first time or not.
    void publishJobEvent({
      jobId: job.id,
      userId: job.userId,
      type: 'job:queued',
      status: 'QUEUED',
    });
    return retried;
  },

  async deleteJob(jobId: string, requester: Requester) {
    const job = await jobRepository.findById(jobId);
    if (!job) throw new NotFoundError('Job');
    assertOwnership(job, requester);

    if (['RUNNING', 'QUEUED'].includes(job.status)) {
      throw new ConflictError('Cannot delete a job that is queued or running — cancel it first.');
    }

    await jobRepository.remove(job.id);
    logger.info('Job deleted', { jobId: job.id, userId: requester.id });
  },
};
