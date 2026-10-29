import { Router } from 'express';
import {
  createMeetingController,
  createScopedMeetingController,
  getMeetingController,
  endMeetingController,
} from '../controllers/meetingController.js';
import {
  getMeetingWhiteboardsController,
  createMeetingWhiteboardController,
  openWhiteboardInMeetingController,
} from '../controllers/whiteboardController.js';
import { authMiddleware, optionalAuth } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/', authMiddleware, createMeetingController);
router.post('/scoped', authMiddleware, createScopedMeetingController);
router.get('/:code',optionalAuth, getMeetingController);
router.post('/:code/end', authMiddleware, endMeetingController);
router.get('/:code/whiteboards', authMiddleware, getMeetingWhiteboardsController);
router.post('/:code/whiteboards', authMiddleware, createMeetingWhiteboardController);
router.post(
  '/:code/whiteboards/:whiteboardId/open',
  authMiddleware,
  openWhiteboardInMeetingController
);

export default router;
