import { prisma } from '@taskflow/shared';

interface AuditLogEntry {
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The AuditLog model has existed in the schema since Phase 1's database
 * design, unused until now — it's used starting here, for exactly the
 * kind of action the spec names it for (section 6: "Track important
 * actions"): an admin acting on another user's account or job. Regular
 * self-service actions (a user cancelling their own job) don't need an
 * audit trail; a user can already see their own activity in their own
 * job/notification history. What's worth a separate, tamper-evident-ish
 * record is specifically when someone acts on a resource that isn't
 * theirs.
 */
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

  findAll(params: { page: number; limit: number }) {
    return Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.auditLog.count(),
    ]).then(([logs, total]) => ({ logs, total }));
  },
};
