import { Router } from 'express';
import {
  createMeetingController,
  getMeetingController,
  endMeetingController,
} from '../controllers/meetingController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/', authMiddleware, createMeetingController);
router.get('/:code', getMeetingController);
router.post('/:code/end', authMiddleware, endMeetingController);

export default router;
