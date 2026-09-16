import { Router } from 'express';
import authRoutes from './auth.routes';
import jobRoutes from './job.routes';
import adminRoutes from './admin.routes';
import notificationRoutes from './notification.routes';
import scheduleRoutes from './schedule.routes';
import dashboardRoutes from './dashboard.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/jobs', jobRoutes);
router.use('/admin', adminRoutes);
router.use('/notifications', notificationRoutes);
router.use('/schedules', scheduleRoutes);
router.use('/dashboard', dashboardRoutes);

export default router;
