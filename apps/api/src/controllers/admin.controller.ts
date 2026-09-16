import type { Request, Response } from 'express';
import { z } from 'zod';
import { adminService } from '../services/admin.service';
import { asyncHandler } from '../utils/asyncHandler';

const listJobsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().optional(),
  type: z.string().optional(),
  priority: z.string().optional(),
  // The one filter the personal /jobs endpoint doesn't have — narrow the
  // global view down to a specific user's jobs without leaving the admin
  // job list.
  userId: z.string().optional(),
});

const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const setActiveSchema = z.object({ isActive: z.boolean() });

export const adminController = {
  /**
   * Satisfies section 13 ("Admin users should be able to inspect
   * dead-letter jobs") via the existing `status` filter — a request for
   * `GET /admin/jobs?status=DEAD_LETTER` is the dead-letter inspection
   * view, not a separate endpoint. Retrying or cancelling any of those
   * jobs reuses the same `POST /jobs/:id/retry` and `/cancel` endpoints
   * every user has — jobService.assertOwnership already lets an ADMIN
   * act on a job it doesn't own, so there's no need for parallel
   * `/admin/jobs/:id/retry` routes that would just call the same code.
   */
  listJobs: asyncHandler(async (req: Request, res: Response) => {
    const query = listJobsQuerySchema.parse(req.query);
    const { jobs, total } = await adminService.listAllJobs(query);
    res.status(200).json({
      success: true,
      data: jobs,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  }),

  listUsers: asyncHandler(async (req: Request, res: Response) => {
    const query = listUsersQuerySchema.parse(req.query);
    const { users, total } = await adminService.listUsers(query);
    res.status(200).json({
      success: true,
      data: users,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  }),

  setUserActive: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = setActiveSchema.parse(req.body);
    const user = await adminService.setUserActive(req.params.id, isActive, req.user!.id);
    res.status(200).json({ success: true, data: user });
  }),
};
