import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import {
  createCommunitySchema,
  updateCommunitySchema,
  createInviteSchema,
  inviteMemberSchema,
  inviteOrLinkSchema,
  respondInviteSchema,
  updateMemberRoleSchema,
  transferOwnershipSchema,
  createChannelSchema,
  updateChannelSchema
} from '../validators/communityValidators.js';
import { createPostSchema } from '../validators/postValidators.js';
import {
  createCommunityController,
  getUserCommunitiesController,
  getCommunityDetailsController,
  updateCommunityController,
  deleteCommunityController,
  createInviteLinkController,
  inviteUserToCommunityController,
  getCommunityInvitesController,
  getUserPendingInvitesController,
  respondToCommunityInviteController,
  acceptCommunityInviteController,
  declineCommunityInviteController,
  validateInviteTokenController,
  joinCommunityViaInviteController,
  revokeInviteLinkController,
  searchUsersToInviteController,
  getCommunityMembersController,
  leaveCommunityController,
  removeCommunityMemberController,
  changeMemberRoleController,
  transferCommunityOwnershipController,
  createChannelController,
  getCommunityChannelsController,
  getChannelDetailsController,
  updateChannelController,
  deleteChannelController
} from '../controllers/communityController.js';
import {
  createPostController,
  getCommunityPostsController,
  getCommunityFeedController
} from '../controllers/postController.js';

const router = Router();

router.post('/', authMiddleware, validate(createCommunitySchema), createCommunityController);
router.get('/', authMiddleware, getUserCommunitiesController);
router.get('/feed', authMiddleware, getCommunityFeedController);

router.get('/invitations/pending', authMiddleware, getUserPendingInvitesController);
router.get('/invites/pending', authMiddleware, getUserPendingInvitesController);
router.post('/invitations/:identifier/accept', authMiddleware, acceptCommunityInviteController);
router.post('/invitations/:identifier/decline', authMiddleware, declineCommunityInviteController);
router.post('/invitations/:identifier/respond', authMiddleware, validate(respondInviteSchema), respondToCommunityInviteController);

router.get('/invites/:token', validateInviteTokenController);
router.post('/invites/:token/join', authMiddleware, joinCommunityViaInviteController);
router.post('/invites/:token/accept', authMiddleware, acceptCommunityInviteController);
router.post('/invites/:token/decline', authMiddleware, declineCommunityInviteController);

router.get('/:id/users/search', authMiddleware, searchUsersToInviteController);
router.get('/:id/invites', authMiddleware, getCommunityInvitesController);
router.post('/:id/invites', authMiddleware, validate(inviteOrLinkSchema), inviteUserToCommunityController);
router.post('/:id/invitations', authMiddleware, validate(inviteOrLinkSchema), inviteUserToCommunityController);
router.delete('/:id/invites/:inviteId', authMiddleware, revokeInviteLinkController);

router.get('/:id/members', authMiddleware, getCommunityMembersController);
router.patch('/:id/members/:userId/role', authMiddleware, validate(updateMemberRoleSchema), changeMemberRoleController);
router.post('/:id/leave', authMiddleware, leaveCommunityController);
router.post('/:id/transfer-ownership', authMiddleware, validate(transferOwnershipSchema), transferCommunityOwnershipController);
router.delete('/:id/members/:userId', authMiddleware, removeCommunityMemberController);

router.get('/:id/channels', authMiddleware, getCommunityChannelsController);
router.post('/:id/channels', authMiddleware, validate(createChannelSchema), createChannelController);
router.get('/:id/channels/:channelId', authMiddleware, getChannelDetailsController);
router.patch('/:id/channels/:channelId', authMiddleware, validate(updateChannelSchema), updateChannelController);
router.delete('/:id/channels/:channelId', authMiddleware, deleteChannelController);
router.get('/:id/channels/:channelId/posts', authMiddleware, getCommunityPostsController);
router.post('/:id/channels/:channelId/posts', authMiddleware, validate(createPostSchema), createPostController);

router.post('/:id/posts', authMiddleware, validate(createPostSchema), createPostController);
router.get('/:id/posts', authMiddleware, getCommunityPostsController);
router.get('/:id/feed', authMiddleware, getCommunityPostsController);

router.get('/:id', authMiddleware, getCommunityDetailsController);
router.patch('/:id', authMiddleware, validate(updateCommunitySchema), updateCommunityController);
router.delete('/:id', authMiddleware, deleteCommunityController);

export default router;
