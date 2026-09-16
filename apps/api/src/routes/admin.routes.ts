import { Router } from 'express';
import { adminController } from '../controllers/admin.controller';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();

// Every admin route requires both a valid session AND the ADMIN role —
// unlike jobRoutes, where ownership is checked per-resource inside the
// service, everything under /admin is gated at the route level because
// none of it is meant to be reachable by a regular user under any
// circumstance.
router.use(authenticate, authorize('ADMIN'));

router.get('/jobs', adminController.listJobs);
router.get('/users', adminController.listUsers);
router.patch('/users/:id', adminController.setUserActive);

export default router;
