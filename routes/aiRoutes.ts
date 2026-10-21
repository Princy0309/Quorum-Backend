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

router.post('/chat', authMiddleware, aiRateLimiterMiddleware, validate(aiChatSchema), chatController);
router.post('/summarize', authMiddleware, aiRateLimiterMiddleware, validate(aiSummarySchema), summarizeChatController);
router.post('/chat/:conversationId/summary', authMiddleware, aiRateLimiterMiddleware, validate(aiSummarySchema), summarizeChatController);
router.post('/search', authMiddleware, aiRateLimiterMiddleware, validate(aiSearchSchema), searchWorkspaceController);
router.post('/project-assistance', authMiddleware, aiRateLimiterMiddleware, validate(aiProjectAssistanceSchema), projectAssistanceController);
router.post('/assistance', authMiddleware, aiRateLimiterMiddleware, validate(aiProjectAssistanceSchema), projectAssistanceController);
router.post('/assist', authMiddleware, aiRateLimiterMiddleware, validate(aiProjectAssistanceSchema), projectAssistanceController);
router.post('/quick-replies', authMiddleware, aiRateLimiterMiddleware, validate(aiQuickRepliesSchema), quickRepliesController);
router.post('/project-update', authMiddleware, aiRateLimiterMiddleware, validate(aiProjectUpdateSchema), projectUpdateController);
router.get('/history', authMiddleware, aiRateLimiterMiddleware, validateQuery(aiHistoryQuerySchema), getHistoryController);
router.delete('/history', authMiddleware, aiRateLimiterMiddleware, deleteHistoryController);
router.delete('/history/:id', authMiddleware, aiRateLimiterMiddleware, deleteHistoryController);

export default router;
