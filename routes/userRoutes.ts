import { Router } from 'express';
import { updateOnboarding, searchUsersController } from '../controllers/userController.js';
import { authMiddleware, requireEmailVerified } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import { onboardingSchema } from '../validators/userValidators.js';
import { searchLimiter } from '../middlewares/rateLimiter.js';

const router = Router();

router.patch(
  '/onboarding',
  authMiddleware,
  requireEmailVerified,
  validate(onboardingSchema),
  updateOnboarding
);

router.get('/search', authMiddleware, searchLimiter, searchUsersController);
router.get('/', authMiddleware, searchLimiter, searchUsersController);

export default router;
