import fs from 'fs';
import path from 'path';
import { prisma } from '@taskflow/shared';
import { env } from '../../config/env';
import { formatJobSummaryCsv, type StatusCount } from './report-format';
import type { JobExecutionContext, JobHandler } from '../handler.types';

interface ReportGenerationPayload {
  reportType?: 'JOB_SUMMARY';
  fromDate?: string;
  toDate?: string;
}

export { formatJobSummaryCsv } from './report-format';

const GENERATED_SUBDIR = 'generated';

export const reportGenerationHandler: JobHandler = {
  async execute(ctx: JobExecutionContext) {
    const payload = ctx.payload as unknown as ReportGenerationPayload;

    await ctx.updateProgress(10);

    // Scoped to the requesting user's own jobs — a report is a summary of
    // *your* job history, not the whole system's (that's the admin
    // metrics view, a later phase).
    const where = {
      userId: ctx.userId,
      ...(payload.fromDate || payload.toDate
        ? {
            createdAt: {
              ...(payload.fromDate ? { gte: new Date(payload.fromDate) } : {}),
              ...(payload.toDate ? { lte: new Date(payload.toDate) } : {}),
            },
          }
        : {}),
    };

    const grouped = await prisma.job.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    await ctx.updateProgress(50);

    const statusCounts: StatusCount[] = grouped.map(
      (g: { status: string; _count: { _all: number } }) => ({
        status: g.status,
        count: g._count._all,
      }),
    );
    const totalJobs = statusCounts.reduce((sum, r) => sum + r.count, 0);
    const completed = statusCounts.find((r) => r.status === 'COMPLETED')?.count ?? 0;
    const failedLike = statusCounts
      .filter((r) => r.status === 'FAILED' || r.status === 'DEAD_LETTER')
      .reduce((sum, r) => sum + r.count, 0);
    const successRate = totalJobs > 0 ? Number(((completed / totalJobs) * 100).toFixed(1)) : 0;

    const csv = formatJobSummaryCsv(statusCounts);

    const outputDir = path.join(env.UPLOAD_DIR, GENERATED_SUBDIR);
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFilename = `report-${ctx.jobId}.csv`;
    fs.writeFileSync(path.join(outputDir, outputFilename), csv, 'utf-8');

    await ctx.updateProgress(100);

    return {
      reportType: payload.reportType ?? 'JOB_SUMMARY',
      totalJobs,
      completedJobs: completed,
      failedJobs: failedLike,
      successRate,
      breakdown: statusCounts,
      reportFile: path.join(GENERATED_SUBDIR, outputFilename),
    };
  },
};
