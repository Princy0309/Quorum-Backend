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
import {
  createTeamController,
  getOrganizationTeamsController,
  getTeamController,
  updateTeamController,
  deleteTeamController,
  addTeamMemberController,
  removeTeamMemberController,
} from '../controllers/teamController.js';

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


router.post(
  '/:id/teams',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN, OrgRole.TEAM_HEAD]),
  createTeamController
);

router.get(
  '/:id/teams',
  authMiddleware,
  requireOrgMember(),
  getOrganizationTeamsController
);

router.get(
  '/:id/teams/:teamId',
  authMiddleware,
  requireOrgMember(),
  getTeamController
);

router.patch(
  '/:id/teams/:teamId',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN, OrgRole.TEAM_HEAD]),
  updateTeamController
);

router.delete(
  '/:id/teams/:teamId',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN, OrgRole.TEAM_HEAD]),
  deleteTeamController
);

router.post(
  '/:id/teams/:teamId/members',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN, OrgRole.TEAM_HEAD]),
  addTeamMemberController
);

router.delete(
  '/:id/teams/:teamId/members/:userId',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN, OrgRole.TEAM_HEAD]),
  removeTeamMemberController
);



export default router;
