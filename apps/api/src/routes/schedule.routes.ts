import { Router } from 'express';
import { scheduleController } from '../controllers/schedule.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/', scheduleController.create);
router.get('/', scheduleController.list);
router.get('/:id', scheduleController.getById);
router.patch('/:id', scheduleController.update);
router.delete('/:id', scheduleController.remove);

export default router;
