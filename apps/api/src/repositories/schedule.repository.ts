import { prisma } from '@taskflow/shared';
import type { Prisma } from '@taskflow/shared';

export interface ScheduleListFilters {
  userId: string;
  page: number;
  limit: number;
}

export const scheduleRepository = {
  create(data: Prisma.ScheduleCreateInput) {
    return prisma.schedule.create({ data });
  },

  findById(id: string) {
    return prisma.schedule.findUnique({ where: { id } });
  },

  async findMany(filters: ScheduleListFilters) {
    const where = { userId: filters.userId };
    const [schedules, total] = await Promise.all([
      prisma.schedule.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.schedule.count({ where }),
    ]);
    return { schedules, total };
  },

  /**
   * The scheduler's core query: every active schedule due to fire. Not
   * scoped to a user — the scheduler runs once for the whole system, not
   * once per user, so it needs to see every schedule regardless of who
   * owns it.
   */
  findDue(now: Date) {
    return prisma.schedule.findMany({
      where: { isActive: true, nextRunAt: { lte: now } },
    });
  },

  update(id: string, data: Prisma.ScheduleUpdateInput) {
    return prisma.schedule.update({ where: { id }, data });
  },

  remove(id: string) {
    return prisma.schedule.delete({ where: { id } });
  },
};
