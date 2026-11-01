import { Router } from 'express';
import {
  updateOnboarding,
  searchUsersController,
  getUserProfileController,
  updateUserProfileController,
  getUserPresenceController,
  getBatchUserPresenceController
} from '../controllers/userController.js';
import { authMiddleware, requireEmailVerified } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import { onboardingSchema, updateProfileSchema } from '../validators/userValidators.js';
import { searchLimiter } from '../middlewares/rateLimiter.js';
import { uploadMiddleware } from '../controllers/uploadController.js';

const router = Router();

// Profile endpoints (Web & Mobile compatible)
router.get('/profile', authMiddleware, requireEmailVerified, getUserProfileController);
router.get('/me', authMiddleware, requireEmailVerified, getUserProfileController);
router.put(
  '/profile',
  authMiddleware,
  requireEmailVerified,
  uploadMiddleware,
  validate(updateProfileSchema),
  updateUserProfileController
);
router.patch(
  '/profile',
  authMiddleware,
  requireEmailVerified,
  uploadMiddleware,
  validate(updateProfileSchema),
  updateUserProfileController
);

router.patch(
  '/onboarding',
  authMiddleware,
  requireEmailVerified,
  validate(onboardingSchema),
  updateOnboarding
);

// Presence endpoints
router.get('/presence', authMiddleware, getBatchUserPresenceController);
router.post('/presence/batch', authMiddleware, getBatchUserPresenceController);
router.get('/presence/:userId', authMiddleware, getUserPresenceController);
router.get('/:userId/presence', authMiddleware, getUserPresenceController);

router.get('/search', authMiddleware, searchLimiter, searchUsersController);
router.get('/', authMiddleware, searchLimiter, searchUsersController);

export default router;
