import type { JobType } from '../constants/job-types';

/**
 * What actually goes on the queue — deliberately just enough to look the
 * job back up, not a copy of its payload/state. See docs/queue-system.md
 * ("What goes on the queue — and what doesn't") for why: Postgres is the
 * single source of truth for a job's payload and status everywhere else
 * in the system, and duplicating that onto the queue would just create a
 * second copy that could drift out of sync.
 */
export interface JobQueueData {
  jobId: string;
  type: JobType;
}
