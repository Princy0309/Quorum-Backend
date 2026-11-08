import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { searchLimiter, chatLimiter } from '../middlewares/rateLimiter.js';
import { validate } from '../middlewares/validate.js';
import {
  createGroupSchema,
  addParticipantsSchema,
  updateGroupSchema,
  editMessageSchema,
  deleteMessageSchema,
  toggleReactionSchema,
  forwardMessagesSchema,
  createPollSchema,
  votePollSchema
} from '../validators/chatValidators.js';
import {
  getUserConversationsController,
  getUnreadConversationsCountController,
  getConversationMessagesController,
  searchConversationMessagesController,
  createGroupConversationController,
  addGroupParticipantsController,
  removeGroupParticipantController,
  updateGroupConversationController,
  getGroupProfilePictureController,
  updateGroupProfilePictureController,
  deleteGroupProfilePictureController,
  leaveGroupConversationController,
  getConversationDetailsController,
  makeGroupAdminController,
  dismissGroupAdminController,
  editMessageController,
  deleteMessageController,
  getConversationPresenceController,
  toggleMessageReactionController,
  getMessageReactionsController,
  forwardMessagesController,
  createPollController,
  votePollController
} from '../controllers/conversationController.js';
import { createOrGetDMController } from '../controllers/dmController.js';
import { uploadMiddleware } from '../controllers/uploadController.js';

const router = Router();

router.get('/', authMiddleware, getUserConversationsController);
router.get('/unread-count', authMiddleware, getUnreadConversationsCountController);
router.post('/', authMiddleware, chatLimiter, createOrGetDMController);
router.post('/direct', authMiddleware, chatLimiter, createOrGetDMController);
router.post('/dm', authMiddleware, chatLimiter, createOrGetDMController);
router.get('/search', authMiddleware, searchLimiter, getUserConversationsController);
router.post('/group', authMiddleware, validate(createGroupSchema), createGroupConversationController);
router.post('/messages/forward', authMiddleware, validate(forwardMessagesSchema), forwardMessagesController);
router.post('/:id/messages/poll', authMiddleware, validate(createPollSchema), createPollController);
router.post('/:id/messages/:messageId/poll/vote', authMiddleware, validate(votePollSchema), votePollController);
router.post('/:id/polls/:pollId/vote', authMiddleware, validate(votePollSchema), votePollController);
router.get('/:id/presence', authMiddleware, getConversationPresenceController);
router.get('/:id', authMiddleware, getConversationDetailsController);
router.get('/:id/messages', authMiddleware, getConversationMessagesController);
router.patch('/:id/messages/:messageId', authMiddleware, validate(editMessageSchema), editMessageController);
router.delete('/:id/messages/:messageId', authMiddleware, validate(deleteMessageSchema), deleteMessageController);
router.post('/:id/messages/:messageId/reactions', authMiddleware, validate(toggleReactionSchema), toggleMessageReactionController);
router.get('/:id/messages/:messageId/reactions', authMiddleware, getMessageReactionsController);
router.patch('/:id', authMiddleware, uploadMiddleware, validate(updateGroupSchema), updateGroupConversationController);

router.get('/:id/profile-picture', authMiddleware, getGroupProfilePictureController);
router.post('/:id/profile-picture', authMiddleware, uploadMiddleware, updateGroupProfilePictureController);
router.put('/:id/profile-picture', authMiddleware, uploadMiddleware, updateGroupProfilePictureController);
router.delete('/:id/profile-picture', authMiddleware, deleteGroupProfilePictureController);

router.get('/:id/avatar', authMiddleware, getGroupProfilePictureController);
router.post('/:id/avatar', authMiddleware, uploadMiddleware, updateGroupProfilePictureController);
router.put('/:id/avatar', authMiddleware, uploadMiddleware, updateGroupProfilePictureController);
router.delete('/:id/avatar', authMiddleware, deleteGroupProfilePictureController);

router.get('/:id/image', authMiddleware, getGroupProfilePictureController);
router.post('/:id/image', authMiddleware, uploadMiddleware, updateGroupProfilePictureController);
router.put('/:id/image', authMiddleware, uploadMiddleware, updateGroupProfilePictureController);
router.delete('/:id/image', authMiddleware, deleteGroupProfilePictureController);

router.post('/:id/participants', authMiddleware, validate(addParticipantsSchema), addGroupParticipantsController);
router.post('/:id/members', authMiddleware, validate(addParticipantsSchema), addGroupParticipantsController);
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



