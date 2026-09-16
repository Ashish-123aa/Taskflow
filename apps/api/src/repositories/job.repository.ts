import { prisma } from '@taskflow/shared';
import type { Prisma } from '@taskflow/shared';

export interface JobListFilters {
  userId?: string; // omitted entirely for an admin's "all jobs" query
  status?: string;
  type?: string;
  priority?: string;
  page: number;
  limit: number;
}

/**
 * All direct Prisma access for the Job model goes through this file —
 * services never call `prisma.job.*` directly. `status`/`priority` filter
 * values are cast to Prisma's generated enum types; they've already been
 * validated against JOB_STATUSES/JOB_PRIORITIES by Zod before reaching
 * here, so the cast reflects a validated invariant, not a type hole.
 */
export const jobRepository = {
  create(data: Prisma.JobCreateInput) {
    return prisma.job.create({ data });
  },

  findById(id: string) {
    return prisma.job.findUnique({
      where: { id },
      include: { jobAttempts: { orderBy: { attemptNumber: 'asc' } } },
    });
  },

  async findMany(filters: JobListFilters) {
    const where: Prisma.JobWhereInput = {
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.status ? { status: filters.status as Prisma.JobWhereInput['status'] } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.priority
        ? { priority: filters.priority as Prisma.JobWhereInput['priority'] }
        : {}),
    };

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.job.count({ where }),
    ]);

    return { jobs, total };
  },

  update(id: string, data: Prisma.JobUpdateInput) {
    return prisma.job.update({ where: { id }, data });
  },

  remove(id: string) {
    return prisma.job.delete({ where: { id } });
  },

  /**
   * Everything the dashboard (section 20) needs, scoped to one user's own
   * jobs — three grouped/aggregate queries plus a bounded recent-jobs
   * fetch for the "jobs over time" chart, run concurrently. No Redis
   * caching yet (that's Phase 9's job); this is just the data layer the
   * frontend needs to exist at all.
   */
  async getStats(userId: string, sinceDays: number) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

    const [byStatus, byType, recentJobs, completedDurations] = await Promise.all([
      prisma.job.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
      prisma.job.groupBy({ by: ['type'], where: { userId }, _count: { _all: true } }),
      prisma.job.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { status: true, createdAt: true },
      }),
      // Duration isn't a stored column on Job — it's derived from
      // startedAt/completedAt on whichever run actually succeeded.
      // Pulling just those two timestamps for completed jobs is far
      // cheaper than fetching full rows just to compute an average.
      prisma.job.findMany({
        where: { userId, status: 'COMPLETED', startedAt: { not: null }, completedAt: { not: null } },
        select: { startedAt: true, completedAt: true },
      }),
    ]);

    return { byStatus, byType, recentJobs, completedDurations };
  },
};
