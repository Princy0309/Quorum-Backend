import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validateJoi } from '../middlewares/validate.js';
import {
  createCommunitySchema,
  updateCommunitySchema,
  createInviteSchema,
  updateMemberRoleSchema,
  transferOwnershipSchema
} from '../validators/communityValidators.js';
import { createPostSchema } from '../validators/postValidators.js';
import {
  createCommunityController,
  getUserCommunitiesController,
  getCommunityDetailsController,
  updateCommunityController,
  deleteCommunityController,
  createInviteLinkController,
  validateInviteTokenController,
  joinCommunityViaInviteController,
  revokeInviteLinkController,
  searchUsersToInviteController,
  getCommunityMembersController,
  leaveCommunityController,
  removeCommunityMemberController,
  changeMemberRoleController,
  transferCommunityOwnershipController
} from '../controllers/communityController.js';
import {
  createPostController,
  getCommunityPostsController
} from '../controllers/postController.js';

const router = Router();

router.post('/', authMiddleware, validateJoi(createCommunitySchema), createCommunityController);
router.get('/', authMiddleware, getUserCommunitiesController);

router.get('/invites/:token', validateInviteTokenController);
router.post('/invites/:token/join', authMiddleware, joinCommunityViaInviteController);

router.get('/:id/users/search', authMiddleware, searchUsersToInviteController);
router.post('/:id/invites', authMiddleware, validateJoi(createInviteSchema), createInviteLinkController);
router.delete('/:id/invites/:inviteId', authMiddleware, revokeInviteLinkController);

router.get('/:id/members', authMiddleware, getCommunityMembersController);
router.patch('/:id/members/:userId/role', authMiddleware, validateJoi(updateMemberRoleSchema), changeMemberRoleController);
router.post('/:id/leave', authMiddleware, leaveCommunityController);
router.post('/:id/transfer-ownership', authMiddleware, validateJoi(transferOwnershipSchema), transferCommunityOwnershipController);
router.delete('/:id/members/:userId', authMiddleware, removeCommunityMemberController);

router.post('/:id/posts', authMiddleware, validateJoi(createPostSchema), createPostController);
router.get('/:id/posts', authMiddleware, getCommunityPostsController);

router.get('/:id', authMiddleware, getCommunityDetailsController);
router.patch('/:id', authMiddleware, validateJoi(updateCommunitySchema), updateCommunityController);
router.delete('/:id', authMiddleware, deleteCommunityController);

export default router;
