import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  getUserConversationsController,
  getConversationMessagesController,
  searchConversationMessagesController
} from '../controllers/conversationController.js';

const router = Router();

router.get('/', authMiddleware, getUserConversationsController);
router.get('/:id/messages', authMiddleware, getConversationMessagesController);
router.get('/:id/search', authMiddleware, searchConversationMessagesController);

export default router;


