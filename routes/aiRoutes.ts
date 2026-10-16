import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import {
  aiChatSchema,
  aiSummarySchema,
  aiSearchSchema,
  aiProjectAssistanceSchema
} from '../validators/aiValidators.js';
import {
  chatController,
  summarizeChatController,
  searchWorkspaceController,
  projectAssistanceController
} from '../controllers/aiController.js';

const router = Router();

router.post('/chat', authMiddleware, validate(aiChatSchema), chatController);
router.post('/chat/:conversationId/summary', authMiddleware, validate(aiSummarySchema), summarizeChatController);
router.post('/search', authMiddleware, validate(aiSearchSchema), searchWorkspaceController);
router.post('/project-assistance', authMiddleware, validate(aiProjectAssistanceSchema), projectAssistanceController);

export default router;
