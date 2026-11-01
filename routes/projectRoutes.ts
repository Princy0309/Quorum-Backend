import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import {
  requireProjectMember,
  requireProjectAdmin,
} from '../middlewares/projectAuth.js';
import {
  createProjectSchema,
  updateProjectSchema,
  inviteProjectMemberSchema,
  createProjectTaskSchema,
  updateProjectTaskSchema,
  updateTaskStatusSchema,
  submitTaskDeliverableSchema,
  approveTaskDeliverableSchema,
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
  removeProjectMemberController,
  createProjectTaskController,
  getProjectTasksController,
  updateProjectTaskController,
  updateProjectTaskStatusController,
  submitTaskDeliverableController,
  approveTaskDeliverableController,
} from '../controllers/projectController.js';

const router = Router();

// ==========================================
// 1. User & Invitation Level Endpoints
// ==========================================

// List all projects user is a member/collaborator of (internal or external)
router.get('/', authMiddleware, getUserProjectsController);
router.get('/my-projects', authMiddleware, getUserProjectsController);

// Accept project invitation (freelancers & external partners)
router.post('/accept-invite', authMiddleware, acceptProjectInviteController);
router.post('/invites/accept', authMiddleware, acceptProjectInviteController);
router.get('/invites/accept/:token', authMiddleware, acceptProjectInviteController);

// ==========================================
// 2. Organization Level Project Endpoints
// ==========================================

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

// ==========================================
// 3. Project Detail & Member Management
// ==========================================

router.get('/:id', authMiddleware, requireProjectMember, getProjectDetailsController);
router.patch(
  '/:id',
  authMiddleware,
  requireProjectAdmin,
  validate(updateProjectSchema),
  updateProjectController
);
router.delete('/:id', authMiddleware, requireProjectAdmin, deleteProjectController);

// Invite external freelancer or internal member to project
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

// Remove member/freelancer from project
router.delete(
  '/:id/members/:userId',
  authMiddleware,
  requireProjectAdmin,
  removeProjectMemberController
);

// ==========================================
// 4. Tasks & Deliverables Workflow
// ==========================================

// List tasks for a project
router.get('/:id/tasks', authMiddleware, requireProjectMember, getProjectTasksController);

// Create task in project (Admin / Project Manager)
router.post(
  '/:id/tasks',
  authMiddleware,
  requireProjectAdmin,
  validate(createProjectTaskSchema),
  createProjectTaskController
);

// Update task details
router.patch(
  '/:id/tasks/:taskId',
  authMiddleware,
  requireProjectMember,
  validate(updateProjectTaskSchema),
  updateProjectTaskController
);

// Fast status progression (TODO -> IN_PROGRESS -> etc.)
router.patch(
  '/:id/tasks/:taskId/status',
  authMiddleware,
  requireProjectMember,
  validate(updateTaskStatusSchema),
  updateProjectTaskStatusController
);

// Submit deliverable (Freelancers)
router.post(
  '/:id/tasks/:taskId/deliverable',
  authMiddleware,
  requireProjectMember,
  validate(submitTaskDeliverableSchema),
  submitTaskDeliverableController
);

// Approve or reject deliverable (Admin / Project Manager)
router.post(
  '/:id/tasks/:taskId/review',
  authMiddleware,
  requireProjectAdmin,
  validate(approveTaskDeliverableSchema),
  approveTaskDeliverableController
);

export default router;
