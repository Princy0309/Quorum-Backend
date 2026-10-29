import { Router } from 'express';
import {
  createMeetingController,
  createScopedMeetingController,
  getMeetingController,
  endMeetingController,
  cancelMeetingController,
  getOrganizationMeetingsController,
  getTeamMeetingsController,
  getUserUpcomingMeetingsController,
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
router.get('/upcoming', authMiddleware, getUserUpcomingMeetingsController);
router.get('/organization/:organizationId', authMiddleware, getOrganizationMeetingsController);
router.get('/team/:teamId', authMiddleware, getTeamMeetingsController);
router.get('/:code', optionalAuth, getMeetingController);
router.post('/:code/end', authMiddleware, endMeetingController);
router.patch('/:code/cancel', authMiddleware, cancelMeetingController);
router.get('/:code/whiteboards', authMiddleware, getMeetingWhiteboardsController);
router.post('/:code/whiteboards', authMiddleware, createMeetingWhiteboardController);
router.post(
  '/:code/whiteboards/:whiteboardId/open',
  authMiddleware,
  openWhiteboardInMeetingController
);

export default router;
