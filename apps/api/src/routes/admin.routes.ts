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
// Phase 10.2 — the read side of the audit trail admin actions have
// already been writing to since Phase 5 (auditLogRepository.record,
// called from adminService.setUserActive and jobService's admin-
// override paths). Covered by the same route-level `authorize('ADMIN')`
// gate as every other route in this file — no separate authorization
// logic needed here, matching how the rest of this file already works.
router.get('/audit-logs', adminController.listAuditLogs);

export default router;
