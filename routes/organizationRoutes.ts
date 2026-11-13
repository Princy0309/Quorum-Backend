import { Router } from 'express';
import { OrgRole } from '@prisma/client';
import {
  createOrganizationController,
  getUserOrganizationsController,
  getOrganizationController,
  updateOrganizationController,
  getOrganizationProfilePictureController,
  updateOrganizationProfilePictureController,
  deleteOrganizationProfilePictureController,
  getOrganizationMembersController,
  updateMemberRoleController,
  removeMemberController,
  leaveOrganizationController,
  createInviteController,
  getInvitePreviewController,
  acceptInviteController,
  getOrganizationInvitesController,
  revokeInviteController,
  deleteOrganizationController,

} from '../controllers/organizationController.js';

import {
  createTeamTicketController,
  getTeamTicketsController,
  getTicketDetailsController,
  transitionTicketStatusController,
  getTeamAssigneesController,
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
  getTeamMembersController,
  leaveTeamController,
  transferLeadAndLeaveController,
  getTeamMessagesController,
  sendTeamMessageController,
  deleteTeamMessageController,
  pinTeamMessageController,
} from '../controllers/teamController.js';
import { uploadMiddleware } from '../controllers/uploadController.js';

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
  createTeamSchema,
  updateTeamSchema,
} from '../validators/organizationValidators.js';

import rateLimit from 'express-rate-limit';
import {
  createOrgPostController,
  getOrgFeedController,
  getOrgPostByIdController,
  updateOrgPostController,
  deleteOrgPostController,
  togglePinOrgPostController,
  toggleOrgPostReactionController,
  createOrgCommentController,
  getOrgCommentsController,
  updateOrgCommentController,
  deleteOrgCommentController,
} from '../controllers/orgFeedController.js';
import {
  createOrgPostSchema,
  updateOrgPostSchema,
  toggleReactionSchema,
  createOrgCommentSchema,
  updateOrgCommentSchema,
} from '../validators/orgFeedValidators.js';

const router = Router();

router.get('/join/:token', getInvitePreviewController);
router.post('/join/:token', authMiddleware, acceptInviteController);


router.post('/', authMiddleware, validate(createOrganizationSchema), createOrganizationController);
router.get('/', authMiddleware, getUserOrganizationsController);
router.get('/search', authMiddleware, getUserOrganizationsController);

router.get('/:id', authMiddleware, requireOrgMember(), getOrganizationController);
router.patch(
  '/:id',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  uploadMiddleware,
  validate(updateOrganizationSchema),
  updateOrganizationController
);

router.get('/:id/profile-picture', authMiddleware, requireOrgMember(), getOrganizationProfilePictureController);
router.post(
  '/:id/profile-picture',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  uploadMiddleware,
  updateOrganizationProfilePictureController
);
router.put(
  '/:id/profile-picture',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  uploadMiddleware,
  updateOrganizationProfilePictureController
);
router.delete(
  '/:id/profile-picture',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  deleteOrganizationProfilePictureController
);

router.get('/:id/avatar', authMiddleware, requireOrgMember(), getOrganizationProfilePictureController);
router.post(
  '/:id/avatar',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  uploadMiddleware,
  updateOrganizationProfilePictureController
);
router.put(
  '/:id/avatar',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  uploadMiddleware,
  updateOrganizationProfilePictureController
);
router.delete(
  '/:id/avatar',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  deleteOrganizationProfilePictureController
);

router.get('/:id/logo', authMiddleware, requireOrgMember(), getOrganizationProfilePictureController);
router.post(
  '/:id/logo',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  uploadMiddleware,
  updateOrganizationProfilePictureController
);
router.put(
  '/:id/logo',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  uploadMiddleware,
  updateOrganizationProfilePictureController
);
router.delete(
  '/:id/logo',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  deleteOrganizationProfilePictureController
);

router.delete(
  '/:id',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  deleteOrganizationController
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
  validate(createTeamSchema),
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
  validate(updateTeamSchema),
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

router.get(
  '/:id/teams/:teamId/members',
  authMiddleware,
  requireOrgMember(),
  getTeamMembersController
);

router.post(
  '/:id/teams/:teamId/leave',
  authMiddleware,
  requireOrgMember(),
  leaveTeamController
);

router.post(
  '/:id/teams/:teamId/messages',
  authMiddleware,
  requireOrgMember(),
  uploadMiddleware,
  sendTeamMessageController
);

router.post(
  '/:id/teams/:teamId/transfer-lead-and-leave',
  authMiddleware,
  requireOrgMember(),
  transferLeadAndLeaveController
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

// ---------------------------------------------------------------------------
// Organization Jira Integration Routes
// Supports both '/:id/integrations/jira' and '/:id/jira' route aliases so mobile
// and web clients can request either path without encountering 404 errors.
// ---------------------------------------------------------------------------

// 1. Setup / Link Organization to Jira Project (Admin only)
router.post(
  ['/:id/integrations/jira/setup', '/:id/jira/setup'],
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN]),
  setupOrgJiraController
);

// 2. Get Organization Jira Integration Status (Org Members)
router.get(
  ['/:id/integrations/jira', '/:id/jira'],
  authMiddleware,
  requireOrgMember(),
  getOrgJiraStatusController
);

// 3. Disconnect Organization Jira Integration (Admin only)
router.delete(
  ['/:id/integrations/jira', '/:id/jira'],
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

// 4. Get Team or Organization Jira Assignable Users
// Supports multiple path aliases so mobile apps can query by team or org
router.get(
  [
    '/:id/teams/:teamId/jira/assignees',
    '/:id/teams/:teamId/jira/users',
    '/:id/teams/:teamId/assignees',
    '/:id/integrations/jira/assignees',
    '/:id/integrations/jira/users',
    '/:id/jira/assignees',
    '/:id/jira/users',
  ],
  authMiddleware,
  requireOrgMember(),
  getTeamAssigneesController
);

const orgFeedWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many feed requests. Please wait a minute and try again.',
  },
  keyGenerator: (req) => req.user?.id || req.ip || 'anonymous',
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/:id/feed', authMiddleware, requireOrgMember(), getOrgFeedController);
router.post(
  '/:id/feed',
  authMiddleware,
  requireOrgMember(),
  orgFeedWriteLimiter,
  uploadMiddleware,
  validate(createOrgPostSchema),
  createOrgPostController
);

router.get('/:id/feed/:postId', authMiddleware, requireOrgMember(), getOrgPostByIdController);
router.patch(
  '/:id/feed/:postId',
  authMiddleware,
  requireOrgMember(),
  uploadMiddleware,
  validate(updateOrgPostSchema),
  updateOrgPostController
);
router.delete('/:id/feed/:postId', authMiddleware, requireOrgMember(), deleteOrgPostController);

router.post(
  '/:id/feed/:postId/pin',
  authMiddleware,
  requireOrgMember([OrgRole.ORG_ADMIN, OrgRole.TEAM_HEAD]),
  togglePinOrgPostController
);

router.post(
  '/:id/feed/:postId/react',
  authMiddleware,
  requireOrgMember(),
  orgFeedWriteLimiter,
  validate(toggleReactionSchema),
  toggleOrgPostReactionController
);

router.get('/:id/feed/:postId/comments', authMiddleware, requireOrgMember(), getOrgCommentsController);
router.post(
  '/:id/feed/:postId/comments',
  authMiddleware,
  requireOrgMember(),
  orgFeedWriteLimiter,
  validate(createOrgCommentSchema),
  createOrgCommentController
);
router.patch(
  '/:id/feed/:postId/comments/:commentId',
  authMiddleware,
  requireOrgMember(),
  validate(updateOrgCommentSchema),
  updateOrgCommentController
);
router.delete(
  '/:id/feed/:postId/comments/:commentId',
  authMiddleware,
  requireOrgMember(),
  deleteOrgCommentController
);

export default router;

