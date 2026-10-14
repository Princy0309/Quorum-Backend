import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { searchLimiter, chatLimiter } from '../middlewares/rateLimiter.js';
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
  updateGroupConversationController,
  leaveGroupConversationController,
  getConversationDetailsController,
  makeGroupAdminController,
  dismissGroupAdminController
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
router.delete('/:id/leave', authMiddleware, leaveGroupConversationController);
router.post('/:id/leave', authMiddleware, leaveGroupConversationController);
router.post('/:id/admins', authMiddleware, makeGroupAdminController);
router.post('/:id/admins/:userId', authMiddleware, makeGroupAdminController);
router.post('/:id/make-admin', authMiddleware, makeGroupAdminController);
router.post('/:id/participants/:userId/make-admin', authMiddleware, makeGroupAdminController);
router.delete('/:id/admins/:userId', authMiddleware, dismissGroupAdminController);
router.post('/:id/remove-admin', authMiddleware, dismissGroupAdminController);

router.delete('/:id/participants/:userId', authMiddleware, removeGroupParticipantController);
router.delete('/:id/members/:userId', authMiddleware, removeGroupParticipantController);

export default router;



