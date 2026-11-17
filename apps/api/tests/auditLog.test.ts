import { describe, expect, it, vi } from 'vitest';

// audit.repository.ts imports `prisma` from the @taskflow/shared barrel,
// which also constructs a live PrismaClient at import time — a
// construction this file has no use for (the two things under test here
// are pure: a where-clause builder and a Zod schema, neither of which
// ever calls Prisma) and this sandbox can't generate anyway (see the
// identical comment in rateLimit.test.ts). `prisma` is stubbed with an
// empty object purely so the import doesn't throw; nothing in this file
// ever calls a method on it.
vi.mock('@taskflow/shared', () => ({ prisma: {} }));

import { buildAuditLogWhereClause } from '../src/repositories/audit.repository';
import { listAuditLogsQuerySchema } from '../src/controllers/admin.controller';

describe('buildAuditLogWhereClause', () => {
  it('returns an empty filter when nothing is provided', () => {
    expect(buildAuditLogWhereClause({})).toEqual({});
  });

  it('filters by the acting admin (userId) alone', () => {
    expect(buildAuditLogWhereClause({ userId: 'admin-1' })).toEqual({ userId: 'admin-1' });
  });

  it('filters by action alone', () => {
    expect(buildAuditLogWhereClause({ action: 'USER_DISABLED' })).toEqual({
      action: 'USER_DISABLED',
    });
  });

  it('filters by resource and resourceId together', () => {
    expect(buildAuditLogWhereClause({ resource: 'Job', resourceId: 'job-123' })).toEqual({
      resource: 'Job',
      resourceId: 'job-123',
    });
  });

  it('builds a one-sided date range from fromDate alone', () => {
    const fromDate = new Date('2026-01-01T00:00:00.000Z');
    expect(buildAuditLogWhereClause({ fromDate })).toEqual({
      createdAt: { gte: fromDate },
    });
  });

  it('builds a one-sided date range from toDate alone', () => {
    const toDate = new Date('2026-01-31T23:59:59.000Z');
    expect(buildAuditLogWhereClause({ toDate })).toEqual({
      createdAt: { lte: toDate },
    });
  });

  it('builds a two-sided date range when both are given', () => {
    const fromDate = new Date('2026-01-01T00:00:00.000Z');
    const toDate = new Date('2026-01-31T23:59:59.000Z');
    expect(buildAuditLogWhereClause({ fromDate, toDate })).toEqual({
      createdAt: { gte: fromDate, lte: toDate },
    });
  });

  it('combines every filter at once', () => {
    const fromDate = new Date('2026-01-01T00:00:00.000Z');
    const result = buildAuditLogWhereClause({
      userId: 'admin-1',
      action: 'ADMIN_JOB_CANCEL',
      resource: 'Job',
      resourceId: 'job-123',
      fromDate,
    });

    expect(result).toEqual({
      userId: 'admin-1',
      action: 'ADMIN_JOB_CANCEL',
      resource: 'Job',
      resourceId: 'job-123',
      createdAt: { gte: fromDate },
    });
  });

  it('omits a filter whose value is an empty string, rather than matching literal empty strings', () => {
    expect(buildAuditLogWhereClause({ userId: '', action: 'X' })).toEqual({ action: 'X' });
  });
});

describe('listAuditLogsQuerySchema', () => {
  it('defaults page, limit, and sortOrder when nothing is provided', () => {
    const result = listAuditLogsQuerySchema.parse({});
    expect(result).toMatchObject({ page: 1, limit: 20, sortOrder: 'desc' });
  });

  it('coerces string query values (as Express always provides) into numbers', () => {
    const result = listAuditLogsQuerySchema.parse({ page: '3', limit: '50' });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(50);
  });

  it('rejects a limit above the 100 ceiling', () => {
    expect(() => listAuditLogsQuerySchema.parse({ limit: '500' })).toThrow();
  });

  it('accepts every documented filter field', () => {
    const result = listAuditLogsQuerySchema.parse({
      userId: 'admin-1',
      action: 'USER_DISABLED',
      resource: 'User',
      resourceId: 'user-1',
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
      sortOrder: 'asc',
    });

    expect(result.userId).toBe('admin-1');
    expect(result.action).toBe('USER_DISABLED');
    expect(result.resource).toBe('User');
    expect(result.resourceId).toBe('user-1');
    expect(result.fromDate).toBeInstanceOf(Date);
    expect(result.toDate).toBeInstanceOf(Date);
    expect(result.sortOrder).toBe('asc');
  });

  it('rejects a sortOrder value that is not "asc" or "desc"', () => {
    expect(() => listAuditLogsQuerySchema.parse({ sortOrder: 'sideways' })).toThrow();
  });

  it('rejects an invalid fromDate', () => {
    expect(() => listAuditLogsQuerySchema.parse({ fromDate: 'not-a-date' })).toThrow();
  });
});
