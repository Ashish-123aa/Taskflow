/**
 * What every job handler receives to do its work, and what it's expected
 * to return. Deliberately narrow: a handler gets the job's payload and a
 * progress callback — it has no access to BullMQ, Express, or Prisma
 * directly. All Postgres/queue bookkeeping (status transitions, attempt
 * records) is the worker's job (workers/job.worker.ts), not the handler's
 * — see docs/worker-system.md ("What the worker does around every handler
 * call").
 */
export interface JobExecutionContext {
  jobId: string;
  userId: string;
  payload: Record<string, unknown>;
  attempt: number;
  updateProgress: (percent: number) => Promise<void>;
}

export interface JobHandler {
  /**
   * Do the work. Return value becomes `Job.result`. Throw a plain `Error`
   * for anything that might succeed on retry; throw `NonRetryableJobError`
   * (utils/errors.ts) for anything that provably won't.
   */
  execute(ctx: JobExecutionContext): Promise<Record<string, unknown>>;
}
