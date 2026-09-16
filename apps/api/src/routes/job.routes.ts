import { Router } from 'express';
import { jobController } from '../controllers/job.controller';
import { authenticate } from '../middleware/auth';
import { uploadCsv, uploadImage } from '../middleware/upload';

const router = Router();

// Every job route requires a logged-in user. Which jobs a user can see or
// act on beyond that (own jobs vs. all jobs for an admin) is enforced in
// jobService, not here — see assertOwnership in job.service.ts.
router.use(authenticate);

router.post('/', jobController.create);
router.get('/', jobController.list);

// Upload endpoints create a job the same way POST / does (same
// jobService.createJob), just building the payload from an uploaded file
// instead of a JSON body — see middleware/upload.ts for the file
// validation/safe-filename handling.
router.post('/upload/csv', uploadCsv, jobController.uploadCsvJob);
router.post('/upload/image', uploadImage, jobController.uploadImageJob);

router.get('/:id', jobController.getById);
router.get('/:id/download', jobController.downloadResult);
router.post('/:id/cancel', jobController.cancel);
router.post('/:id/retry', jobController.retry);
router.delete('/:id', jobController.remove);

export default router;
