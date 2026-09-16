import { prisma } from '@taskflow/shared';

type NotificationType = 'JOB_COMPLETED' | 'JOB_FAILED' | 'JOB_DEAD_LETTER' | 'SCHEDULE_TRIGGERED';

export const notificationRepository = {
  async findMany(params: { userId: string; page: number; limit: number; unreadOnly?: boolean }) {
    const where = {
      userId: params.userId,
      ...(params.unreadOnly ? { isRead: false } : {}),
    };

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.notification.count({ where }),
      // Returned alongside every page, not just the first — a notification
      // bell badge needs the true unread count regardless of which page
      // of the list is currently showing.
      prisma.notification.count({ where: { userId: params.userId, isRead: false } }),
    ]);

    return { notifications, total, unreadCount };
  },

  findById(id: string) {
    return prisma.notification.findUnique({ where: { id } });
  },

  markRead(id: string) {
    return prisma.notification.update({ where: { id }, data: { isRead: true } });
  },

  /**
   * The one write method here — added in Phase 7 specifically for the
   * scheduler (which runs inside this process, unlike job completion/
   * failure notifications, which the worker creates via its own
   * create-only repository). Everything else in this file stays
   * read/update, matching what the REST endpoints actually need.
   */
  create(data: { userId: string; jobId?: string; type: NotificationType; message: string }) {
    return prisma.notification.create({ data });
  },
};
