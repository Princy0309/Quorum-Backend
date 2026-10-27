import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  getAuthorizeUrlController,
  handleOAuthCallbackController,
  disconnectJiraController,
  getJiraStatusController,
} from '../controllers/jiraOAuthController.js';

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
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/oauth/authorize-url', authMiddleware, authorizeLimiter, getAuthorizeUrlController);
router.get('/oauth/callback', handleOAuthCallbackController);
router.post('/disconnect', authMiddleware, disconnectJiraController);
router.get('/oauth/status', authMiddleware, getJiraStatusController);

export default router;
