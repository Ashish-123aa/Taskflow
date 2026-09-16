import type { Request, Response } from 'express';
import { z } from 'zod';
import { createScheduleSchema, updateScheduleSchema } from '@taskflow/shared';
import { scheduleService } from '../services/schedule.service';
import { asyncHandler } from '../utils/asyncHandler';

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const scheduleController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const input = createScheduleSchema.parse(req.body);
    const schedule = await scheduleService.createSchedule({ ...input, userId: req.user!.id });
    res.status(201).json({ success: true, data: schedule });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const query = listQuerySchema.parse(req.query);
    const { schedules, total } = await scheduleService.listSchedules(req.user!.id, query);
    res.status(200).json({
      success: true,
      data: schedules,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const schedule = await scheduleService.getSchedule(req.params.id, req.user!.id);
    res.status(200).json({ success: true, data: schedule });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const input = updateScheduleSchema.parse(req.body);
    const schedule = await scheduleService.updateSchedule(req.params.id, req.user!.id, input);
    res.status(200).json({ success: true, data: schedule });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await scheduleService.deleteSchedule(req.params.id, req.user!.id);
    res.status(200).json({ success: true, data: { message: 'Schedule deleted' } });
  }),
};
