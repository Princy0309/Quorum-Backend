import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError.js';
import { verifyProjectMemberAccess, verifyProjectAdminAccess } from '../services/projectService.js';
import { ProjectRole } from '@prisma/client';

export interface AuthenticatedProjectRequest extends Request {
  projectMember?: {
    role: ProjectRole;
    id?: string;
    projectId?: string;
    userId?: string;
  };
}

export const requireProjectMember = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new ApiError(401, 'Unauthorized'));
    }

    const rawId = req.params.projectId || req.params.id;
    const projectId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!projectId) {
      return next(new ApiError(400, 'Project ID is required'));
    }

    const member = await verifyProjectMemberAccess(userId, projectId);
    (req as AuthenticatedProjectRequest).projectMember = member as any;
    next();
  } catch (err) {
    next(err);
  }
};

export const requireProjectAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new ApiError(401, 'Unauthorized'));
    }

    const rawId = req.params.projectId || req.params.id;
    const projectId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!projectId) {
      return next(new ApiError(400, 'Project ID is required'));
    }

    const member = await verifyProjectAdminAccess(userId, projectId);
    (req as AuthenticatedProjectRequest).projectMember = member as any;
    next();
  } catch (err) {
    next(err);
  }
};
