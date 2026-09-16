import { Router } from 'express';
import { dashboardService } from '../services/dashboard.service';
import { asyncHandler } from '../utils/asyncHandler';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get(
  '/stats',
  authenticate,
  asyncHandler(async (req, res) => {
    const stats = await dashboardService.getStats(req.user!.id);
    res.status(200).json({ success: true, data: stats });
  }),
);

export default router;
