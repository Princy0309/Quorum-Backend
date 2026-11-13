import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  getAuthorizeUrlController,
  handleOAuthCallbackController,
  disconnectJiraController,
  getJiraStatusController,
} from '../controllers/jiraOAuthController.js';

import { getMyTicketsController, createTeamTicketController, getTeamTicketsController, getTicketDetailsController, transitionTicketStatusController, getTeamAssigneesController } from '../controllers/jiraTicketController.js';
import { handleJiraWebhookController } from '../controllers/jiraWebhookController.js';

const router = Router();

const authorizeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many Jira authorization attempts. Please wait a minute and try again.',
  },
  keyGenerator: (req) => req.user?.id || req.ip || 'anonymous',
  validate: false,
  standardHeaders: true,
  legacyHeaders: false,
});


router.get(
  ['/oauth/authorize-url', '/authorize-url'],
  authMiddleware,
  authorizeLimiter,
  getAuthorizeUrlController
);

router.get('/oauth/callback', handleOAuthCallbackController);

router.post(
  ['/disconnect', '/oauth/disconnect'],
  authMiddleware,
  disconnectJiraController
);

router.get(
  ['/oauth/status', '/status', '/'],
  authMiddleware,
  getJiraStatusController
);

router.get('/tickets/my', authMiddleware, getMyTicketsController);

router.post('/teams/:teamId/tickets', authMiddleware, createTeamTicketController);

router.get('/teams/:teamId/tickets', authMiddleware, getTeamTicketsController);

router.get('/teams/:teamId/tickets/:key', authMiddleware, getTicketDetailsController);

router.post('/teams/:teamId/tickets/:key/transition', authMiddleware, transitionTicketStatusController);

router.get('/teams/:teamId/assignees', authMiddleware, getTeamAssigneesController);

router.get('/organizations/:id/assignees', authMiddleware, getTeamAssigneesController);


router.post('/webhook', handleJiraWebhookController);

export default router;