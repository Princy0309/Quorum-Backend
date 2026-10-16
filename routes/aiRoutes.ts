import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import { aiChatSchema, aiSummarySchema } from '../validators/aiValidators.js';
import { chatController, summarizeChatController } from '../controllers/aiController.js';

const router = Router();

router.post('/chat', authMiddleware, validate(aiChatSchema), chatController);
router.post('/chat/:conversationId/summary', authMiddleware, validate(aiSummarySchema), summarizeChatController);

export default router;
