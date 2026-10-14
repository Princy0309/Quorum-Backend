import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { searchLimiter, chatLimiter } from '../middlewares/rateLimiter.js';
import { validateJoi } from '../middlewares/validate.js';
import {
  createGroupSchema,
  addParticipantsSchema,
  updateGroupSchema,
  transferOwnershipSchema
} from '../validators/chatValidators.js';
import {
  getUserConversationsController,
  getConversationMessagesController,
  searchConversationMessagesController,
  createGroupConversationController,
  addGroupParticipantsController,
  removeGroupParticipantController,
  updateGroupConversationController,
  transferGroupOwnershipController,
  getConversationDetailsController
} from '../controllers/conversationController.js';
import { createOrGetDMController } from '../controllers/dmController.js';

const router = Router();

router.get('/', authMiddleware, getUserConversationsController);
router.post('/', authMiddleware, chatLimiter, createOrGetDMController);
router.post('/direct', authMiddleware, chatLimiter, createOrGetDMController);
router.post('/dm', authMiddleware, chatLimiter, createOrGetDMController);
router.get('/search', authMiddleware, searchLimiter, getUserConversationsController);
router.post('/group', authMiddleware, validateJoi(createGroupSchema), createGroupConversationController);
router.get('/:id', authMiddleware, getConversationDetailsController);
router.get('/:id/messages', authMiddleware, getConversationMessagesController);
router.get('/:id/search', authMiddleware, searchConversationMessagesController);
router.patch('/:id', authMiddleware, validateJoi(updateGroupSchema), updateGroupConversationController);
router.post('/:id/participants', authMiddleware, validateJoi(addParticipantsSchema), addGroupParticipantsController);
router.post('/:id/members', authMiddleware, validateJoi(addParticipantsSchema), addGroupParticipantsController);
router.post('/:id/transfer-ownership', authMiddleware, validateJoi(transferOwnershipSchema), transferGroupOwnershipController);
router.post('/:id/leave', authMiddleware, (req, res, next) => {
  req.params.userId = 'me';
  return removeGroupParticipantController(req, res, next);
});
router.delete('/:id/participants/:userId', authMiddleware, removeGroupParticipantController);
router.delete('/:id/members/:userId', authMiddleware, removeGroupParticipantController);

export default router;



