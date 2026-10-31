import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  getAuthorizeUrlController,
  handleOAuthCallbackController,
  disconnectJiraController,
  getJiraStatusController,
} from '../controllers/jiraOAuthController.js';

import { getMyTicketsController } from '../controllers/jiraTicketController.js';
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

// ---------------------------------------------------------------------------
// User Jira Integration Routes (/api/integrations/jira and /api/v1/integrations/jira)
// Provides OAuth 2.0 3LO authorization, connection status, token revocation,
// personal tickets, and webhook handling.
// Multiple path aliases are provided to support diverse frontend/mobile clients.
// ---------------------------------------------------------------------------

// 1. Generate Atlassian OAuth Consent URL
// Supports both '/oauth/authorize-url' and shorthand '/authorize-url'
router.get(
  ['/oauth/authorize-url', '/authorize-url'],
  authMiddleware,
  authorizeLimiter,
  getAuthorizeUrlController
);

// 2. OAuth Callback from Atlassian (Public endpoint visited via browser redirect)
router.get('/oauth/callback', handleOAuthCallbackController);

// 3. Disconnect Personal Jira Account (Revokes Atlassian tokens)
router.post(
  ['/disconnect', '/oauth/disconnect'],
  authMiddleware,
  disconnectJiraController
);

// 4. Get Current User's Personal Jira Connection Status
// Supports '/oauth/status', '/status', and the root '/' of the integration router
router.get(
  ['/oauth/status', '/status', '/'],
  authMiddleware,
  getJiraStatusController
);

// 5. Get Tickets Assigned to the Current User
router.get('/tickets/my', authMiddleware, getMyTicketsController);

// 6. Incoming Jira Webhook Event Dispatcher
router.post('/webhook', handleJiraWebhookController);

export default router;
