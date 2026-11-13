import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate, validateQuery } from '../middlewares/validate.js';
import {
  requireProjectMember,
  requireProjectAdmin,
} from '../middlewares/projectAuth.js';
import {
  createProjectSchema,
  updateProjectSchema,
  inviteProjectMemberSchema,
  updateProjectMemberRoleSchema,
  createProjectTaskSchema,
  updateProjectTaskSchema,
  getProjectTasksQuerySchema,
  updateTaskStatusSchema,
  submitTaskDeliverableSchema,
  approveTaskDeliverableSchema,
  createProjectResourceSchema,
} from '../validators/projectValidators.js';
import {
  createProjectController,
  getOrganizationProjectsController,
  getUserProjectsController,
  getProjectDetailsController,
  updateProjectController,
  deleteProjectController,
  inviteProjectMemberController,
  acceptProjectInviteController,
  getProjectInvitePreviewController,
  updateProjectMemberController,
  removeProjectMemberController,
  createProjectTaskController,
  getProjectTasksController,
  updateProjectTaskController,
  updateProjectTaskStatusController,
  submitTaskDeliverableController,
  approveTaskDeliverableController,
  addProjectResourceController,
  getProjectResourcesController,
  deleteProjectResourceController,
} from '../controllers/projectController.js';

const router = Router();

router.get('/', authMiddleware, getUserProjectsController);
router.post(
  '/',
  authMiddleware,
  validate(createProjectSchema),
  createProjectController
);
router.get('/my-projects', authMiddleware, getUserProjectsController);

router.post('/accept-invite', authMiddleware, acceptProjectInviteController);
router.post('/invites/accept', authMiddleware, acceptProjectInviteController);

router.get('/invites/preview/:token', getProjectInvitePreviewController);
router.get('/invites/:token', getProjectInvitePreviewController);

router.post(
  '/organization/:organizationId',
  authMiddleware,
  validate(createProjectSchema),
  createProjectController
);
router.get(
  '/organization/:organizationId',
  authMiddleware,
  getOrganizationProjectsController
);

router.post(
  '/org/:organizationId',
  authMiddleware,
  validate(createProjectSchema),
  createProjectController
);
router.get(
  '/org/:organizationId',
  authMiddleware,
  getOrganizationProjectsController
);

router.get('/:id', authMiddleware, requireProjectMember, getProjectDetailsController);
router.patch(
  '/:id',
  authMiddleware,
  requireProjectAdmin,
  validate(updateProjectSchema),
  updateProjectController
);
router.delete('/:id', authMiddleware, requireProjectAdmin, deleteProjectController);

router.post(
  '/:id/invites',
  authMiddleware,
  requireProjectAdmin,
  validate(inviteProjectMemberSchema),
  inviteProjectMemberController
);
router.post(
  '/:id/members/invite',
  authMiddleware,
  requireProjectAdmin,
  validate(inviteProjectMemberSchema),
  inviteProjectMemberController
);

router.patch(
  '/:id/members/:userId',
  authMiddleware,
  requireProjectAdmin,
  validate(updateProjectMemberRoleSchema),
  updateProjectMemberController
);

router.delete(
  '/:id/members/:userId',
  authMiddleware,
  requireProjectAdmin,
  removeProjectMemberController
);

router.get(
  '/:id/tasks',
  authMiddleware,
  requireProjectMember,
  validateQuery(getProjectTasksQuerySchema),
  getProjectTasksController
);

router.post(
  '/:id/tasks',
  authMiddleware,
  requireProjectAdmin,
  validate(createProjectTaskSchema),
  createProjectTaskController
);

router.patch(
  '/:id/tasks/:taskId',
  authMiddleware,
  requireProjectMember,
  validate(updateProjectTaskSchema),
  updateProjectTaskController
);

router.patch(
  '/:id/tasks/:taskId/status',
  authMiddleware,
  requireProjectMember,
  validate(updateTaskStatusSchema),
  updateProjectTaskStatusController
);

router.post(
  '/:id/tasks/:taskId/deliverable',
  authMiddleware,
  requireProjectMember,
  validate(submitTaskDeliverableSchema),
  submitTaskDeliverableController
);

router.post(
  '/:id/tasks/:taskId/review',
  authMiddleware,
  requireProjectAdmin,
  validate(approveTaskDeliverableSchema),
  approveTaskDeliverableController
);

router.post(
  '/:id/resources',
  authMiddleware,
  requireProjectMember,
  validate(createProjectResourceSchema),
  addProjectResourceController
);

router.get(
  '/:id/resources',
  authMiddleware,
  requireProjectMember,
  getProjectResourcesController
);

router.delete(
  '/:id/resources/:resourceId',
  authMiddleware,
  requireProjectMember,
  deleteProjectResourceController
);

export default router;
