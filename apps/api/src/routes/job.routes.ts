import { Router } from 'express';
import { jobController } from '../controllers/job.controller';
import { authenticate } from '../middleware/auth';
import { uploadCsv, uploadImage } from '../middleware/upload';
import { jobCreateRateLimiter } from '../middleware/rateLimiters';

const router = Router();

// Every job route requires a logged-in user. Which jobs a user can see or
// act on beyond that (own jobs vs. all jobs for an admin) is enforced in
// jobService, not here — see assertOwnership in job.service.ts.
router.use(authenticate);

router.post('/', jobCreateRateLimiter, jobController.create);
router.get('/', jobController.list);

// Upload endpoints create a job the same way POST / does (same
// jobService.createJob), just building the payload from an uploaded file
// instead of a JSON body — see middleware/upload.ts for the file
// validation/safe-filename handling. They share POST /'s rate-limit
// budget (section 25: "Job creation: 20 jobs / minute" means every way
// of creating one, not just this specific path) and, deliberately, run
// the limiter *before* multer — a rate-limited caller gets rejected
// before TaskFlow spends any effort parsing or writing their file to
// disk.
router.post('/upload/csv', jobCreateRateLimiter, uploadCsv, jobController.uploadCsvJob);
router.post('/upload/image', jobCreateRateLimiter, uploadImage, jobController.uploadImageJob);

router.get('/:id', jobController.getById);
router.get('/:id/download', jobController.downloadResult);
router.post('/:id/cancel', jobController.cancel);
router.post('/:id/retry', jobController.retry);
router.delete('/:id', jobController.remove);

export default router;
