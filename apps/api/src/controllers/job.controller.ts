import fs from 'fs';
import path from 'path';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createJobSchema, retryJobSchema, JOB_PRIORITIES, type CreateJobInput } from '@taskflow/shared';
import { jobService } from '../services/job.service';
import { asyncHandler } from '../utils/asyncHandler';
import { env } from '../config/env';
import { NotFoundError, ValidationError } from '../utils/errors';

const listJobsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().optional(),
  type: z.string().optional(),
  priority: z.string().optional(),
});

const uploadPrioritySchema = z.enum(JOB_PRIORITIES).default('MEDIUM');

export const jobController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const input = createJobSchema.parse(req.body);
    const job = await jobService.createJob({ ...input, userId: req.user!.id });
    res.status(201).json({ success: true, data: job });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const query = listJobsQuerySchema.parse(req.query);
    const { jobs, total } = await jobService.listJobs(req.user!, query);
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

  getById: asyncHandler(async (req: Request, res: Response) => {
    const job = await jobService.getJob(req.params.id, req.user!);
    res.status(200).json({ success: true, data: job });
  }),

  cancel: asyncHandler(async (req: Request, res: Response) => {
    const job = await jobService.cancelJob(req.params.id, req.user!);
    res.status(200).json({ success: true, data: job });
  }),

  retry: asyncHandler(async (req: Request, res: Response) => {
    // Body is optional — POST with no body retries at the job's existing
    // maxAttempts; a body of { "maxAttempts": 5 } grants a fresh cycle
    // with a different ceiling (see docs/queue-system.md).
    const options = retryJobSchema.parse(req.body ?? {});
    const job = await jobService.retryJob(req.params.id, req.user!, options);
    res.status(200).json({ success: true, data: job });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await jobService.deleteJob(req.params.id, req.user!);
    res.status(200).json({ success: true, data: { message: 'Job deleted' } });
  }),

  /**
   * multer (see middleware/upload.ts) has already validated the file's
   * type/size and written it to disk with a safe, random filename by the
   * time this runs — this just builds the CSV_PROCESSING job payload
   * around that already-validated file.
   */
  uploadCsvJob: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new ValidationError('No file uploaded (expected multipart field "file")');
    }

    const priority = uploadPrioritySchema.parse(req.body.priority);
    const job = await jobService.createJob({
      userId: req.user!.id,
      name: (req.body.name as string) || req.file.originalname,
      type: 'CSV_PROCESSING',
      priority,
      payload: {
        storedFilename: req.file.filename,
        originalFilename: req.file.originalname,
        sizeBytes: req.file.size,
      },
    });
    res.status(201).json({ success: true, data: job });
  }),

  uploadImageJob: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new ValidationError('No file uploaded (expected multipart field "file")');
    }

    let operations: unknown = {};
    if (typeof req.body.operations === 'string' && req.body.operations.length > 0) {
      try {
        operations = JSON.parse(req.body.operations);
      } catch {
        throw new ValidationError('"operations" must be valid JSON if provided');
      }
    }

    const priority = uploadPrioritySchema.parse(req.body.priority);
    const job = await jobService.createJob({
      userId: req.user!.id,
      name: (req.body.name as string) || req.file.originalname,
      type: 'IMAGE_PROCESSING',
      priority,
      payload: {
        storedFilename: req.file.filename,
        originalFilename: req.file.originalname,
        operations,
      },
    } as CreateJobInput & { userId: string });
    res.status(201).json({ success: true, data: job });
  }),

  /**
   * Serves whatever file a completed REPORT_GENERATION or
   * IMAGE_PROCESSING job produced (result.reportFile / result.outputFile
   * respectively — see those handlers in apps/worker). Ownership is
   * enforced by jobService.getJob before the filesystem is touched at all.
   */
  downloadResult: asyncHandler(async (req: Request, res: Response) => {
    const job = await jobService.getJob(req.params.id, req.user!);
    const result = job.result as Record<string, unknown> | null;
    const relativePath = (result?.reportFile ?? result?.outputFile) as string | undefined;

    if (!relativePath) {
      throw new NotFoundError('Downloadable result');
    }

    const absolutePath = path.join(env.UPLOAD_DIR, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new NotFoundError('Downloadable result');
    }

    res.download(absolutePath);
  }),
};
