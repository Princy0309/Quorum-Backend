import { Router } from 'express';
import {
  createMeetingController,
  getMeetingController,
  endMeetingController,
} from '../controllers/meetingController.js';
import {
  getMeetingWhiteboardsController,
  createMeetingWhiteboardController,
  openWhiteboardInMeetingController,
} from '../controllers/whiteboardController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/', authMiddleware, createMeetingController);
router.get('/:code', getMeetingController);
router.post('/:code/end', authMiddleware, endMeetingController);
router.get('/:code/whiteboards', authMiddleware, getMeetingWhiteboardsController);
router.post('/:code/whiteboards', authMiddleware, createMeetingWhiteboardController);
router.post(
  '/:code/whiteboards/:whiteboardId/open',
  authMiddleware,
  openWhiteboardInMeetingController
);

export default router;
