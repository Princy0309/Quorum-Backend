import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError.js';
import {
  workflowPlanSchema,
  workflowExecuteSchema,
} from '../validators/workflowValidators.js';
import {
  generateWorkflowPlan,
  executeWorkflowPlan,
} from '../services/workflowService.js';

export const planWorkflowController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const parsed = workflowPlanSchema.parse(req.body);
    const timezone = parsed.timezone || (typeof req.headers['x-timezone'] === 'string' ? req.headers['x-timezone'] : undefined);
    const clientTime = parsed.clientTime || (typeof req.headers['x-client-time'] === 'string' ? req.headers['x-client-time'] : undefined);
    const result = await generateWorkflowPlan(userId, parsed.prompt, parsed.organizationId, parsed.autoExecute, timezone, clientTime, parsed.confirmed);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

export const executeWorkflowController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, 'Unauthorized');
    }

    const parsed = workflowExecuteSchema.parse(req.body);
    const result = await executeWorkflowPlan(userId, parsed.planId, parsed.confirmed);

    res.status(200).json({
      success: true,
      message: 'Workflow executed successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
