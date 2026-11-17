import { jobRepository } from '../repositories/job.repository';
import { dashboardStatsCache } from './dashboardCache';

const DAYS_OF_HISTORY = 14;

interface DayBucket {
  date: string; // YYYY-MM-DD
  total: number;
  completed: number;
  failed: number;
}

export interface DashboardStats {
  totalJobs: number;
  completedJobs: number;
  runningJobs: number;
  failedJobs: number;
  queuedJobs: number;
  successRate: number;
  avgProcessingTimeMs: number;
  jobsByType: { type: string; count: number }[];
  jobsByStatus: { status: string; count: number }[];
  jobsOverTime: DayBucket[];
}

export const dashboardService = {
  /**
   * Phase 9.3 — reads through the cache before ever touching Postgres.
   * A cache miss (or a Redis failure, which dashboardStatsCache swallows
   * and reports as a miss) falls through to `computeStats`, the original
   * computation, unchanged; a successful compute is then written back so
   * the next request within the TTL window skips it. See
   * services/dashboardCache.ts for the TTL, the per-user key, and the
   * graceful-degradation policy.
   */
  async getStats(userId: string): Promise<DashboardStats> {
    const cached = await dashboardStatsCache.get<DashboardStats>(userId);
    if (cached) return cached;

    const stats = await computeStats(userId);
    await dashboardStatsCache.set(userId, stats);
    return stats;
  },
};

async function computeStats(userId: string): Promise<DashboardStats> {
  const { byStatus, byType, recentJobs, completedDurations } = await jobRepository.getStats(
    userId,
    DAYS_OF_HISTORY,
  );

  const statusCounts = Object.fromEntries(
    byStatus.map((row: { status: string; _count: { _all: number } }) => [row.status, row._count._all]),
  ) as Record<string, number>;

  const totalJobs = byStatus.reduce(
    (sum: number, row: { _count: { _all: number } }) => sum + row._count._all,
    0,
  );
  const completedJobs = statusCounts.COMPLETED ?? 0;
  const runningJobs = statusCounts.RUNNING ?? 0;
  const queuedJobs = (statusCounts.QUEUED ?? 0) + (statusCounts.PENDING ?? 0);
  // "Failed", for the headline stat, means terminally failed by any
  // path — a plain FAILED and a DEAD_LETTER both mean the same thing to
  // someone glancing at the dashboard: this job did not succeed and
  // nothing further is happening automatically. The jobsByStatus
  // breakdown below keeps them distinct for anyone who wants the detail.
  const failedJobs = (statusCounts.FAILED ?? 0) + (statusCounts.DEAD_LETTER ?? 0);

  const finishedJobs = completedJobs + failedJobs;
  const successRate = finishedJobs > 0 ? Number(((completedJobs / finishedJobs) * 100).toFixed(1)) : 0;

  const durationsMs = completedDurations
    .filter((j: { startedAt: Date | null; completedAt: Date | null }) => j.startedAt && j.completedAt)
    .map(
      (j: { startedAt: Date | null; completedAt: Date | null }) =>
        j.completedAt!.getTime() - j.startedAt!.getTime(),
    );
  const avgProcessingTimeMs =
    durationsMs.length > 0
      ? Math.round(durationsMs.reduce((sum: number, d: number) => sum + d, 0) / durationsMs.length)
      : 0;

  const jobsByType = byType.map((row: { type: string; _count: { _all: number } }) => ({
    type: row.type,
    count: row._count._all,
  }));

  const jobsByStatus = byStatus.map((row: { status: string; _count: { _all: number } }) => ({
    status: row.status,
    count: row._count._all,
  }));

  const jobsOverTime = buildDailyBuckets(recentJobs, DAYS_OF_HISTORY);

  return {
    totalJobs,
    completedJobs,
    runningJobs,
    failedJobs,
    queuedJobs,
    successRate,
    avgProcessingTimeMs,
    jobsByType,
    jobsByStatus,
    jobsOverTime,
  };
}

/**
 * Buckets a flat list of {status, createdAt} rows into one entry per
 * calendar day for the last `days` days, including days with zero jobs —
 * a line chart with gaps for quiet days reads as a data error, not as
 * "nothing happened that day", so every day in range gets an explicit
 * zero-filled entry rather than being omitted.
 */
function buildDailyBuckets(rows: { status: string; createdAt: Date }[], days: number): DayBucket[] {
  const buckets = new Map<string, DayBucket>();

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, { date: key, total: 0, completed: 0, failed: 0 });
  }

  for (const row of rows) {
    const key = row.createdAt.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue; // outside the window we pre-seeded, shouldn't happen given the query's own date filter
    bucket.total += 1;
    if (row.status === 'COMPLETED') bucket.completed += 1;
    if (row.status === 'FAILED' || row.status === 'DEAD_LETTER') bucket.failed += 1;
  }

  return Array.from(buckets.values());
}
