import type { Request, Response } from 'express';
import { z } from 'zod';
import { notificationService } from '../services/notification.service';
import { asyncHandler } from '../utils/asyncHandler';

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  unreadOnly: z.coerce.boolean().optional(),
});

export const notificationController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const { notifications, total, unreadCount } = await notificationService.list(req.user!.id, query);
    res.status(200).json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  }),

  markRead: asyncHandler(async (req: Request, res: Response) => {
    const notification = await notificationService.markRead(req.params.id, req.user!.id);
    res.status(200).json({ success: true, data: notification });
  }),
};
