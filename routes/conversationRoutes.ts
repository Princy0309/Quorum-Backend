import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { getConversationMessagesController } from '../controllers/conversationController.js';

const router = Router();

router.get('/:id/messages', authMiddleware, getConversationMessagesController);

export default router;
