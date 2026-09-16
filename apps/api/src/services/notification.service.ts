import { notificationRepository } from '../repositories/notification.repository';
import { ForbiddenError, NotFoundError } from '../utils/errors';

export const notificationService = {
  list(userId: string, params: { page: number; limit: number; unreadOnly?: boolean }) {
    return notificationRepository.findMany({ userId, ...params });
  },

  /**
   * Unlike jobs, there's no admin-override path here — nothing in the
   * spec asks for an admin to read or manage another user's
   * notifications (section 5's admin capability list doesn't mention
   * notifications at all), so this stays strictly self-service: a
   * notification belongs to exactly the person it was created for.
   */
  async markRead(notificationId: string, userId: string) {
    const notification = await notificationRepository.findById(notificationId);
    if (!notification) throw new NotFoundError('Notification');
    if (notification.userId !== userId) {
      throw new ForbiddenError('You do not have access to this notification');
    }
    return notificationRepository.markRead(notificationId);
  },
};
