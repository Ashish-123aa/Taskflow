import { prisma } from '@taskflow/shared';

type NotificationType = 'JOB_COMPLETED' | 'JOB_FAILED' | 'JOB_DEAD_LETTER';

/**
 * Create-only, deliberately — the worker is where a notification-worthy
 * event actually happens (a job finished, failed, or dead-lettered), but
 * listing/reading/marking-as-read notifications is purely the API's
 * concern (apps/api/src/repositories/notification.repository.ts). The
 * worker never needs those operations, so they're not duplicated here.
 */
export const notificationRepository = {
  create(data: { userId: string; jobId: string; type: NotificationType; message: string }) {
    return prisma.notification.create({ data });
  },
};
