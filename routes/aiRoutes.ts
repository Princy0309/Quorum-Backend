import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import { aiChatSchema, aiSummarySchema, aiSearchSchema } from '../validators/aiValidators.js';
import { chatController, summarizeChatController, searchWorkspaceController } from '../controllers/aiController.js';

const router = Router();

router.post('/chat', authMiddleware, validate(aiChatSchema), chatController);
router.post('/chat/:conversationId/summary', authMiddleware, validate(aiSummarySchema), summarizeChatController);
router.post('/search', authMiddleware, validate(aiSearchSchema), searchWorkspaceController);

export default router;
