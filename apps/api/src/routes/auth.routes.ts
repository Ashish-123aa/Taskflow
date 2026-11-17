import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiters';

const router = Router();

// Only register/login get the strict auth-attempt budget (section 25:
// "5 attempts / minute") — logout is idempotent and harmless to call
// repeatedly, and /me is just a read of the current session, neither of
// which is the kind of endpoint a credential-stuffing or account-
// enumeration attempt actually hits.
router.post('/register', authRateLimiter, authController.register);
router.post('/login', authRateLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);

export default router;
