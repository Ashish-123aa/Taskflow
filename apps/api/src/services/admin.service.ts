import { userRepository } from '../repositories/user.repository';
import { jobRepository, type JobListFilters } from '../repositories/job.repository';
import { auditLogRepository, type AuditLogListFilters } from '../repositories/audit.repository';
import { NotFoundError, ValidationError } from '../utils/errors';

export const adminService = {
  /**
   * The one place in the API that intentionally returns jobs across
   * every user, with no ownership scoping at all. Safe only because the
   * route this backs (`GET /api/v1/admin/jobs`) is gated by
   * `authorize('ADMIN')` in the route middleware — this service trusts
   * that gate rather than re-checking a role here, the same way
   * jobService trusts `authenticate` rather than re-verifying a JWT.
   */
  listAllJobs(filters: Omit<JobListFilters, 'userId'> & { userId?: string }) {
    return jobRepository.findMany(filters);
  },

  listUsers(params: { page: number; limit: number }) {
    return userRepository.findAll(params);
  },

  /**
   * Phase 10.2 — same trust model as listAllJobs above: no per-row
   * ownership check, because the route this backs
   * (`GET /api/v1/admin/audit-logs`) is gated by `authorize('ADMIN')` at
   * the route level, and an audit log is by definition not scoped to
   * "the requester's own" anything.
   */
  listAuditLogs(filters: AuditLogListFilters) {
    return auditLogRepository.findAll(filters);
  },

  async setUserActive(targetUserId: string, isActive: boolean, actingAdminId: string) {
    const existing = await userRepository.findById(targetUserId);
    if (!existing) throw new NotFoundError('User');

    if (targetUserId === actingAdminId && !isActive) {
      // An admin who disables their own account has no path back short of
      // someone else with admin access — or direct database surgery.
      // Refusing this outright is cheaper than the support conversation.
      throw new ValidationError('You cannot disable your own account');
    }

    const updated = await userRepository.setActive(targetUserId, isActive);

    await auditLogRepository.record({
      userId: actingAdminId,
      action: isActive ? 'USER_ENABLED' : 'USER_DISABLED',
      resource: 'User',
      resourceId: targetUserId,
    });

    return updated;
  },
};
