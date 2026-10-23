import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  createTask,
  getTeamTasks,
  updateTaskStatus,
  getMyTasks,
} from '../services/taskService.js';

const getParam = (param: unknown): string => {
  if (typeof param === 'string') return param.trim();
  if (Array.isArray(param) && typeof param[0] === 'string') return param[0].trim();
  return String(param || '').trim();
};

export const createTaskController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);
    const { title, description, dueDate, assigneeId } = req.body;

    const task = await createTask(orgId, teamId, req.user.id, {
      title,
      description,
      dueDate,
      assigneeId,
    });

    return res.status(201).json({
      success: true,
      message: 'Task created and assigned successfully',
      data: task,
    });
  }
);

export const getTeamTasksController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);

    const tasks = await getTeamTasks(orgId, teamId);

    return res.status(200).json({
      success: true,
      data: tasks,
    });
  }
);

export const updateTaskStatusController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id || !req.orgMembership) {
      return next(new ApiError(401, 'Unauthorized'));
    }

    const orgId = getParam(req.params.id);
    const teamId = getParam(req.params.teamId);
    const taskId = getParam(req.params.taskId);
    const { status } = req.body;

    if (!status) {
      return next(new ApiError(400, 'Status is required'));
    }

    const updatedTask = await updateTaskStatus(
      orgId,
      teamId,
      taskId,
      req.user.id,
      req.orgMembership.role,
      status
    );

    return res.status(200).json({
      success: true,
      message: 'Task status updated successfully',
      data: updatedTask,
    });
  }
);

export const getMyTasksController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized'));
    }

    const orgId = getParam(req.params.id);
    const tasks = await getMyTasks(orgId, req.user.id);

    return res.status(200).json({
      success: true,
      data: tasks,
    });
  }
);
