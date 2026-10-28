import { Router } from 'express';
import {
  createWhiteboardController,
  getWhiteboardsController,
  getWhiteboardByIdController,
  updateWhiteboardController,
  deleteWhiteboardController,
  openWhiteboardInMeetingController,
  createMeetingWhiteboardController,
  getMeetingWhiteboardsController,
} from '../controllers/whiteboardController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate, validateQuery } from '../middlewares/validate.js';
import {
  createWhiteboardSchema,
  getWhiteboardsQuerySchema,
  updateWhiteboardSchema,
  createMeetingWhiteboardSchema,
} from '../validators/whiteboardValidators.js';

const router = Router();

router.use(authMiddleware);

router.post('/', validate(createWhiteboardSchema), createWhiteboardController);
router.get('/', validateQuery(getWhiteboardsQuerySchema), getWhiteboardsController);
router.get('/meetings/:code', getMeetingWhiteboardsController);
router.post('/meetings/:code', validate(createMeetingWhiteboardSchema), createMeetingWhiteboardController);
router.get('/meeting/:code', getMeetingWhiteboardsController);
router.post('/meeting/:code', validate(createMeetingWhiteboardSchema), createMeetingWhiteboardController);
router.get('/:id', getWhiteboardByIdController);
router.patch('/:id', validate(updateWhiteboardSchema), updateWhiteboardController);
router.delete('/:id', deleteWhiteboardController);
router.post('/:id/meetings/:meetingCode/open', openWhiteboardInMeetingController);
router.post('/:id/meeting/:meetingCode', openWhiteboardInMeetingController);

export default router;
