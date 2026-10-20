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

router.use(authMiddleware);

router.get('/', getNotificationsController);
router.get('', getNotificationsController);
router.get('/unread-count', getUnreadCountController);
router.patch('/read-all', markAllAsReadController);
router.patch('/:id/read', markAsReadController);
router.delete('/:id', deleteNotificationController);
router.get('/preferences', getPreferencesController);
router.put('/preferences', updatePreferenceController);


export default router;
