import { Router } from 'express';
import { updateOnboarding } from '../controllers/userController.js';
import { authMiddleware, requireEmailVerified } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import { onboardingSchema } from '../validators/userValidators.js';

const router = Router();

router.patch(
  '/onboarding',
  authMiddleware,
  requireEmailVerified,
  validate(onboardingSchema),
  updateOnboarding
);

export default router;
