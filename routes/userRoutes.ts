import { Router } from 'express';
import {
  updateOnboarding,
  searchUsersController,
  getUserProfileController,
  updateUserProfileController,
  getUserPresenceController,
  getBatchUserPresenceController,
  updateUserStatusController,
  clearUserStatusController,
} from '../controllers/userController.js';
import {
  getPreferencesController,
  updatePreferenceController,
} from '../controllers/notificationController.js';
import { authMiddleware, requireEmailVerified } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import { onboardingSchema, updateProfileSchema, updateStatusSchema } from '../validators/userValidators.js';
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
router.patch('/status', authMiddleware, validate(updateStatusSchema), updateUserStatusController);
router.delete('/status', authMiddleware, clearUserStatusController);
router.get('/presence', authMiddleware, getBatchUserPresenceController);
router.post('/presence/batch', authMiddleware, getBatchUserPresenceController);
router.get('/presence/:userId', authMiddleware, getUserPresenceController);
router.get('/:userId/presence', authMiddleware, getUserPresenceController);

router.get('/search', authMiddleware, searchLimiter, searchUsersController);
router.get('/', authMiddleware, searchLimiter, searchUsersController);

// User notification preferences aliases (supports /users/preferences, /user/preferences, etc.)
router.get('/preferences', authMiddleware, getPreferencesController);
router.put('/preferences', authMiddleware, updatePreferenceController);
router.patch('/preferences', authMiddleware, updatePreferenceController);
router.post('/preferences', authMiddleware, updatePreferenceController);

router.get('/notification-preferences', authMiddleware, getPreferencesController);
router.put('/notification-preferences', authMiddleware, updatePreferenceController);
router.patch('/notification-preferences', authMiddleware, updatePreferenceController);
router.post('/notification-preferences', authMiddleware, updatePreferenceController);

export default router;
