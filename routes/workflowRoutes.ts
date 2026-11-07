import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { validate } from '../middlewares/validate.js';
import { aiRateLimiterMiddleware } from '../middlewares/rateLimiter.js';
import {
  workflowPlanSchema,
  workflowExecuteSchema,
} from '../validators/workflowValidators.js';
import {
  planWorkflowController,
  executeWorkflowController,
} from '../controllers/workflowController.js';

const router = Router();

router.use(authMiddleware);

router.post(
  '/plan',
  aiRateLimiterMiddleware,
  validate(workflowPlanSchema),
  planWorkflowController
);

router.post(
  '/execute',
  aiRateLimiterMiddleware,
  validate(workflowExecuteSchema),
  executeWorkflowController
);

export default router;
