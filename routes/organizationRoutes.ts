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
  createTeamTicketController,
  getTeamTicketsController,
  getTicketDetailsController,
  transitionTicketStatusController,
} from '../controllers/jiraTicketController.js';


import {
  setupOrgJiraController,
  getOrgJiraStatusController,
  disconnectOrgJiraController,
} from '../controllers/jiraOrgController.js';


import {
  createTeamController,
  getOrganizationTeamsController,
  getTeamController,
  updateTeamController,
  deleteTeamController,
  addTeamMemberController,
  removeTeamMemberController,
  getTeamMessagesController,
  sendTeamMessageController,
  deleteTeamMessageController,
  pinTeamMessageController,
} from '../controllers/teamController.js';

import {
  createTaskController,
  getTeamTasksController,
  updateTaskStatusController,
  getMyTasksController,
} from '../controllers/taskController.js';


import { authMiddleware } from '../middlewares/authMiddleware.js';
import { requireOrgMember } from '../middlewares/orgAuthMiddleware.js';
import { validate } from '../middlewares/validate.js';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from '../validators/organizationValidators.js';

const router = Router();

router.get('/join/:token', getInvitePreviewController);
router.post('/join/:token', authMiddleware, acceptInviteController);


router.post('/', authMiddleware, validate(createOrganizationSchema), createOrganizationController);
router.get('/', authMiddleware, getUserOrganizationsController);

router.get('/:id', authMiddleware, requireOrgMember(), getOrganizationController);
router.patch(
  '/:id',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  validate(updateOrganizationSchema),
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


router.get(
  '/:id/teams/:teamId/messages',
  authMiddleware,
  requireOrgMember(),
  getTeamMessagesController
);

router.post(
  '/:id/teams/:teamId/messages',
  authMiddleware,
  requireOrgMember(),
  sendTeamMessageController
);

router.delete(
  '/:id/teams/:teamId/messages/:messageId',
  authMiddleware,
  requireOrgMember(),
  deleteTeamMessageController
);

router.post(
  '/:id/teams/:teamId/messages/:messageId/pin',
  authMiddleware,
  requireOrgMember(),
  pinTeamMessageController
);

router.post(
  '/:id/teams/:teamId/tasks',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN, OrgRole.TEAM_HEAD]),
  createTaskController
);

router.get(
  '/:id/teams/:teamId/tasks',
  authMiddleware,
  requireOrgMember(),
  getTeamTasksController
);

router.patch(
  '/:id/teams/:teamId/tasks/:taskId/status',
  authMiddleware,
  requireOrgMember(),
  updateTaskStatusController
);

router.get(
  '/:id/tasks/my',
  authMiddleware,
  requireOrgMember(),
  getMyTasksController
);

router.post(
  '/:id/integrations/jira/setup',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  setupOrgJiraController
);

router.get(
  '/:id/integrations/jira',
  authMiddleware,
  requireOrgMember(),
  getOrgJiraStatusController
);

router.delete(
  '/:id/integrations/jira',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  disconnectOrgJiraController
);

router.post(
  '/:id/teams/:teamId/jira/tickets',
  authMiddleware,
  requireOrgMember(),
  createTeamTicketController
);

router.get(
  '/:id/teams/:teamId/jira/tickets',
  authMiddleware,
  requireOrgMember(),
  getTeamTicketsController
);

router.get(
  '/:id/teams/:teamId/jira/tickets/:key',
  authMiddleware,
  requireOrgMember(),
  getTicketDetailsController
);

router.patch(
  '/:id/teams/:teamId/jira/tickets/:key/status',
  authMiddleware,
  requireOrgMember(),
  transitionTicketStatusController
);

export default router;
