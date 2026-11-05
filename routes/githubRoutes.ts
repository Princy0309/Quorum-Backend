import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  getAuthorizeUrlController,
  handleOAuthCallbackController,
  getGithubStatusController,
  disconnectGithubController,
  getUserRepositoriesController,
  linkTeamRepoController,
  getTeamRepoController,
  unlinkTeamRepoController,
  getTeamIssuesController,
  createTeamIssueController,
  updateTeamIssueStatusController,
  getTeamPullRequestsController,
  getTeamCommitsController,
  getTeamBranchesController,
  getTeamCollaboratorsController,
} from '../controllers/githubController.js';

const router = Router();

const authorizeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many GitHub authorization attempts. Please wait a minute and try again.',
  },
  keyGenerator: (req) => req.user?.id || req.ip || 'anonymous',
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
});

// 1. OAuth Flow
router.get(
  ['/oauth/authorize-url', '/authorize-url', '/oauth/authorize'],
  authMiddleware,
  authorizeLimiter,
  getAuthorizeUrlController
);

router.get('/oauth/callback', handleOAuthCallbackController);

router.post(
  ['/disconnect', '/oauth/disconnect'],
  authMiddleware,
  disconnectGithubController
);

router.get(
  ['/oauth/status', '/status', '/'],
  authMiddleware,
  getGithubStatusController
);

// 2. Repositories
router.get('/user/repos', authMiddleware, getUserRepositoriesController);

router.post('/teams/:teamId/repo', authMiddleware, linkTeamRepoController);
router.get('/teams/:teamId/repo', authMiddleware, getTeamRepoController);
router.delete('/teams/:teamId/repo', authMiddleware, unlinkTeamRepoController);

// 3. Issues
router.get('/teams/:teamId/issues', authMiddleware, getTeamIssuesController);
router.post('/teams/:teamId/issues', authMiddleware, createTeamIssueController);
router.patch('/teams/:teamId/issues/:issueNumber', authMiddleware, updateTeamIssueStatusController);

// 4. Pull Requests
router.get('/teams/:teamId/pulls', authMiddleware, getTeamPullRequestsController);

// 5. Commits & Branches
router.get('/teams/:teamId/commits', authMiddleware, getTeamCommitsController);
router.get('/teams/:teamId/branches', authMiddleware, getTeamBranchesController);

// 6. Collaborators / Assignees
router.get('/teams/:teamId/collaborators', authMiddleware, getTeamCollaboratorsController);

export default router;
