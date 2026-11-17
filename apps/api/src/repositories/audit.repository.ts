import { prisma } from '@taskflow/shared';
import type { Prisma } from '@taskflow/shared';

interface AuditLogEntry {
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogListFilters {
  page: number;
  limit: number;
  userId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  fromDate?: Date;
  toDate?: Date;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Builds the Prisma `where` clause for a filtered audit-log query. Split
 * out as its own pure function — no Prisma import beyond the type, no
 * I/O — for the same reason `handlers/report-format.ts` is split out
 * from `report-generation.handler.ts` (see docs/worker-system.md): the
 * part of this feature that needs a live database and the part that's
 * pure filter-combining logic don't have to be tested together just
 * because they're called together. See tests/auditLog.test.ts.
 */
export function buildAuditLogWhereClause(
  filters: Pick<AuditLogListFilters, 'userId' | 'action' | 'resource' | 'resourceId' | 'fromDate' | 'toDate'>,
): Prisma.AuditLogWhereInput {
  return {
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.resource ? { resource: filters.resource } : {}),
    ...(filters.resourceId ? { resourceId: filters.resourceId } : {}),
    ...(filters.fromDate || filters.toDate
      ? {
          createdAt: {
            ...(filters.fromDate ? { gte: filters.fromDate } : {}),
            ...(filters.toDate ? { lte: filters.toDate } : {}),
          },
        }
      : {}),
  };
}

export const auditLogRepository = {
  record(entry: AuditLogEntry) {
    return prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId,
        metadata: entry.metadata as object | undefined,
      },
    });
  },

  /**
   * Phase 10.2: now takes the same filter/sort/paginate shape as
   * `jobRepository.findMany` and `userRepository.findAll`, rather than
   * just page/limit — see `GET /admin/audit-logs`
   * (controllers/admin.controller.ts) for the query parameters this
   * backs.
   */
  async findAll(filters: AuditLogListFilters) {
    const where = buildAuditLogWhereClause(filters);

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: filters.sortOrder ?? 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  },
};
