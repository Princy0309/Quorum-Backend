import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate, validateQuery } from '../middlewares/validate.js';
import { aiRateLimiterMiddleware } from '../middlewares/rateLimiter.js';
import {
  aiChatSchema,
  aiSummarySchema,
  aiSearchSchema,
  aiProjectAssistanceSchema,
  aiQuickRepliesSchema,
  aiProjectUpdateSchema,
  aiHistoryQuerySchema
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

router.use(authMiddleware);
router.use(aiRateLimiterMiddleware);

router.post('/chat', validate(aiChatSchema), chatController);
router.post('/chat/:conversationId/summary', validate(aiSummarySchema), summarizeChatController);
router.post('/search', validate(aiSearchSchema), searchWorkspaceController);
router.post('/project-assistance', validate(aiProjectAssistanceSchema), projectAssistanceController);
router.post('/quick-replies', validate(aiQuickRepliesSchema), quickRepliesController);
router.post('/project-update', validate(aiProjectUpdateSchema), projectUpdateController);
router.get('/history', validateQuery(aiHistoryQuerySchema), getHistoryController);
router.delete('/history', deleteHistoryController);
router.delete('/history/:id', deleteHistoryController);

export default router;
