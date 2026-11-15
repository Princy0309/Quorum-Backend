import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  getNotificationsController,
  getUnreadCountController,
  markAsReadController,
  markAllAsReadController,
  deleteNotificationController,
  getPreferencesController,
  updatePreferenceController,
} from '../controllers/notificationController.js';

const router = Router();

router.get('/',authMiddleware, getNotificationsController);
router.get('', authMiddleware, getNotificationsController);
router.get('/unread-count', authMiddleware, getUnreadCountController);
router.patch('/read-all', authMiddleware, markAllAsReadController);
router.patch('/:id/read', authMiddleware, markAsReadController);
router.delete('/:id', authMiddleware, deleteNotificationController);
router.get('/preferences', authMiddleware, getPreferencesController);
router.put('/preferences', authMiddleware, updatePreferenceController);
router.patch('/preferences', authMiddleware, updatePreferenceController);
router.post('/preferences', authMiddleware, updatePreferenceController);

router.get('/preference', authMiddleware, getPreferencesController);
router.put('/preference', authMiddleware, updatePreferenceController);
router.patch('/preference', authMiddleware, updatePreferenceController);
router.post('/preference', authMiddleware, updatePreferenceController);


export default router;
