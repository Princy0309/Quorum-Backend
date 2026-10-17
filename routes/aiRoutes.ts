import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import {
  aiChatSchema,
  aiSummarySchema,
  aiSearchSchema,
  aiProjectAssistanceSchema,
  aiQuickRepliesSchema,
  aiProjectUpdateSchema
} from '../validators/aiValidators.js';
import {
  chatController,
  summarizeChatController,
  searchWorkspaceController,
  projectAssistanceController,
  quickRepliesController,
  projectUpdateController,
  getHistoryController,
  deleteHistoryController
} from '../controllers/aiController.js';

const router = Router();

router.post('/chat', authMiddleware, validate(aiChatSchema), chatController);
router.post('/chat/:conversationId/summary', authMiddleware, validate(aiSummarySchema), summarizeChatController);
router.post('/search', authMiddleware, validate(aiSearchSchema), searchWorkspaceController);
router.post('/project-assistance', authMiddleware, validate(aiProjectAssistanceSchema), projectAssistanceController);
router.post('/quick-replies', authMiddleware, validate(aiQuickRepliesSchema), quickRepliesController);
router.post('/project-update', authMiddleware, validate(aiProjectUpdateSchema), projectUpdateController);
router.get('/history', authMiddleware, getHistoryController);
router.delete('/history', authMiddleware, deleteHistoryController);
router.delete('/history/:id', authMiddleware, deleteHistoryController);

export default router;
