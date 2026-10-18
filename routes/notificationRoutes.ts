import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  getNotificationsController,
  getUnreadCountController,
  markAsReadController,
  markAllAsReadController,
  deleteNotificationController,
} from '../controllers/notificationController.js';

const router = Router();

router.use(authMiddleware);

router.get('/', getNotificationsController);
router.get('/unread-count', getUnreadCountController);
router.patch('/read-all', markAllAsReadController);
router.patch('/:id/read', markAsReadController);
router.delete('/:id', deleteNotificationController);

export default router;
