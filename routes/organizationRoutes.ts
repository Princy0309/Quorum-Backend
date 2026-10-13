import { Router } from 'express';
import { OrgRole } from '@prisma/client';
import {
  createOrganizationController,
  getUserOrganizationsController,
  getOrganizationController,
  updateOrganizationController,
  getOrganizationMembersController,
  updateMemberRoleController,
  removeMemberController,
  leaveOrganizationController,
  createInviteController,
  getInvitePreviewController,
  acceptInviteController,
  getOrganizationInvitesController,
  revokeInviteController,
} from '../controllers/organizationController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { requireOrgMember } from '../middlewares/orgAuthMiddleware.js';

const router = Router();

router.get('/join/:token', getInvitePreviewController);
router.post('/join/:token', authMiddleware, acceptInviteController);


router.post('/', authMiddleware, createOrganizationController);
router.get('/', authMiddleware, getUserOrganizationsController);

router.get('/:id', authMiddleware, requireOrgMember(), getOrganizationController);
router.patch(
  '/:id',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  updateOrganizationController
);

router.get('/:id/members', authMiddleware, requireOrgMember(), getOrganizationMembersController);

router.patch(
  '/:id/members/:userId',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  updateMemberRoleController
);

router.delete(
  '/:id/members/:userId',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  removeMemberController
);

router.post('/:id/leave', authMiddleware, requireOrgMember(), leaveOrganizationController);

router.post(
  '/:id/invites',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN, OrgRole.TEAM_HEAD]),
  createInviteController
);

router.get(
  '/:id/invites',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN, OrgRole.TEAM_HEAD]),
  getOrganizationInvitesController
);

router.delete(
  '/:id/invites/:inviteId',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  revokeInviteController
);



export default router;
