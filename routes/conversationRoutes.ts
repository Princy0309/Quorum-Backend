import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validateJoi } from '../middlewares/validate.js';
import {
  createGroupSchema,
  addParticipantsSchema,
  updateGroupSchema
} from '../validators/chatValidators.js';
import {
  getUserConversationsController,
  getConversationMessagesController,
  searchConversationMessagesController,
  createGroupConversationController,
  addGroupParticipantsController,
  removeGroupParticipantController,
  updateGroupConversationController
} from '../controllers/conversationController.js';

const router = Router();

router.get('/', authMiddleware, getUserConversationsController);
router.post('/group', authMiddleware, validateJoi(createGroupSchema), createGroupConversationController);
router.get('/:id/messages', authMiddleware, getConversationMessagesController);
router.get('/:id/search', authMiddleware, searchConversationMessagesController);
router.patch('/:id', authMiddleware, validateJoi(updateGroupSchema), updateGroupConversationController);
router.post('/:id/participants', authMiddleware, validateJoi(addParticipantsSchema), addGroupParticipantsController);
router.delete('/:id/participants/:userId', authMiddleware, removeGroupParticipantController);

export default router;


