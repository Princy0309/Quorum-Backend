import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validateJoi } from '../middlewares/validate.js';
import {
  createCommunitySchema,
  updateCommunitySchema,
  createInviteSchema
} from '../validators/communityValidators.js';
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
  removeCommunityMemberController
} from '../controllers/communityController.js';

const router = Router();

router.post('/', authMiddleware, validateJoi(createCommunitySchema), createCommunityController);
router.get('/', authMiddleware, getUserCommunitiesController);

router.get('/invites/:token', validateInviteTokenController);
router.post('/invites/:token/join', authMiddleware, joinCommunityViaInviteController);

router.get('/:id/users/search', authMiddleware, searchUsersToInviteController);
router.post('/:id/invites', authMiddleware, validateJoi(createInviteSchema), createInviteLinkController);
router.delete('/:id/invites/:inviteId', authMiddleware, revokeInviteLinkController);

router.get('/:id/members', authMiddleware, getCommunityMembersController);
router.post('/:id/leave', authMiddleware, leaveCommunityController);
router.delete('/:id/members/:userId', authMiddleware, removeCommunityMemberController);

router.get('/:id', authMiddleware, getCommunityDetailsController);
router.patch('/:id', authMiddleware, validateJoi(updateCommunitySchema), updateCommunityController);
router.delete('/:id', authMiddleware, deleteCommunityController);

export default router;
