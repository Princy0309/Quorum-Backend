import { Router } from 'express';
import {
  startMeetingRecordingController,
  stopMeetingRecordingController,
  getRecordingUploadUrlController,
  getRecordingByIdController,
  completeRecordingController,
  deleteRecordingController,
  summarizeRecordingController,
} from '../controllers/recordingController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authMiddleware);

router.post('/start', startMeetingRecordingController);
router.post('/stop', stopMeetingRecordingController);
router.post('/upload-url', getRecordingUploadUrlController);
router.get('/:id', getRecordingByIdController);
router.put('/:id', completeRecordingController);
router.post('/:id/complete', completeRecordingController);
router.post('/:id/summarize', summarizeRecordingController);
router.delete('/:id', deleteRecordingController);

export default router;
