import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  createProject,
  getOrganizationProjects,
  getUserProjects,
  getProjectDetails,
  updateProject,
  deleteProject,
  inviteProjectMember,
  acceptProjectInvite,
  getProjectInvitePreview,
  updateProjectMember,
  removeProjectMember,
  createProjectTask,
  getProjectTasks,
  updateProjectTask,
  updateProjectTaskStatus,
  submitTaskDeliverable,
  approveTaskDeliverable,
  addProjectResource,
  getProjectResources,
  deleteProjectResource,
} from '../services/projectService.js';
import { ProjectTaskStatus } from '@prisma/client';

const getParamString = (param: unknown): string | undefined => {
  if (Array.isArray(param)) return param[0];
  if (typeof param === 'string') return param;
  return undefined;
};

export const createProjectController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const organizationId =
      getParamString(req.params.organizationId) || req.body.organizationId;
    if (!organizationId) {
      throw new ApiError(400, 'organizationId is required');
    }

    const project = await createProject(userId, organizationId, req.body);
    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: 'Project created successfully',
      data: project,
      project,
    });
  }
);

export const getOrganizationProjectsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const organizationId = getParamString(req.params.organizationId);
    if (!organizationId) {
      throw new ApiError(400, 'organizationId is required');
    }

    const projects = await getOrganizationProjects(userId, organizationId);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Organization projects retrieved successfully',
      data: projects,
      projects,
    });
  }
);

export const getUserProjectsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const organizationId =
      getParamString(req.query.organizationId) ||
      getParamString(req.query.orgId);

    if (organizationId) {
      const projects = await getOrganizationProjects(userId, organizationId);
      return res.status(200).json({
        success: true,
        statusCode: 200,
        message: 'Organization projects retrieved successfully',
        data: projects,
        projects,
      });
    }

    const projects = await getUserProjects(userId);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'User projects retrieved successfully',
      data: projects,
      projects,
    });
  }
);

export const getProjectDetailsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    if (!projectId) throw new ApiError(400, 'Project ID is required');

    const project = await getProjectDetails(userId, projectId);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Project details retrieved successfully',
      data: project,
      project,
    });
  }
);

export const updateProjectController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    if (!projectId) throw new ApiError(400, 'Project ID is required');

    const updated = await updateProject(userId, projectId, req.body);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Project updated successfully',
      data: updated,
      project: updated,
    });
  }
);

export const deleteProjectController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    if (!projectId) throw new ApiError(400, 'Project ID is required');

    const result = await deleteProject(userId, projectId);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: result.message,
    });
  }
);

export const inviteProjectMemberController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    if (!projectId) throw new ApiError(400, 'Project ID is required');

    const invite = await inviteProjectMember(userId, projectId, req.body);
    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: 'Project invite sent successfully',
      data: invite,
      invite,
    });
  }
);

export const acceptProjectInviteController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const token =
      getParamString(req.params.token) || req.body.token || req.query.token;
    if (!token || typeof token !== 'string') {
      throw new ApiError(400, 'Invite token is required');
    }

    const membership = await acceptProjectInvite(userId, token);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Project invite accepted successfully',
      data: membership,
      membership,
    });
  }
);

export const getProjectInvitePreviewController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const token =
      getParamString(req.params.token) || req.body?.token || req.query?.token;
    if (!token || typeof token !== 'string') {
      throw new ApiError(400, 'Invite token is required');
    }

    const preview = await getProjectInvitePreview(token);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Project invite details retrieved successfully',
      data: preview,
      invite: preview,
    });
  }
);

export const updateProjectMemberController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    const targetUserId =
      getParamString(req.params.userId) || getParamString(req.params.memberId);
    if (!projectId || !targetUserId) {
      throw new ApiError(400, 'Project ID and target User ID are required');
    }

    const member = await updateProjectMember(userId, projectId, targetUserId, req.body);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Project member updated successfully',
      data: member,
      member,
    });
  }
);

export const removeProjectMemberController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    const targetUserId =
      getParamString(req.params.userId) || getParamString(req.params.memberId);
    if (!projectId || !targetUserId) {
      throw new ApiError(400, 'Project ID and target User ID are required');
    }

    await removeProjectMember(userId, projectId, targetUserId);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Project member removed successfully',
    });
  }
);

export const createProjectTaskController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    if (!projectId) throw new ApiError(400, 'Project ID is required');

    const task = await createProjectTask(userId, projectId, req.body);
    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: 'Project task created successfully',
      data: task,
      task,
    });
  }
);

export const getProjectTasksController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    if (!projectId) throw new ApiError(400, 'Project ID is required');

    const statusParam = getParamString(req.query.status);
    const assigneeIdParam = getParamString(req.query.assigneeId);

    const tasks = await getProjectTasks(
      userId,
      projectId,
      statusParam,
      assigneeIdParam
    );

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Project tasks retrieved successfully',
      data: tasks,
      tasks,
    });
  }
);

export const updateProjectTaskController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    const taskId = getParamString(req.params.taskId);
    if (!projectId || !taskId) {
      throw new ApiError(400, 'Project ID and Task ID are required');
    }

    const task = await updateProjectTask(userId, projectId, taskId, req.body);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Project task updated successfully',
      data: task,
      task,
    });
  }
);

export const updateProjectTaskStatusController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    const taskId = getParamString(req.params.taskId);
    const { status } = req.body;
    if (!projectId || !taskId || !status) {
      throw new ApiError(400, 'Project ID, Task ID, and status are required');
    }

    const task = await updateProjectTaskStatus(
      userId,
      projectId,
      taskId,
      status as ProjectTaskStatus
    );
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Project task status updated successfully',
      data: task,
      task,
    });
  }
);

export const submitTaskDeliverableController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    const taskId = getParamString(req.params.taskId);
    const { deliverableUrl, deliverableNote } = req.body;
    if (!projectId || !taskId || !deliverableUrl) {
      throw new ApiError(
        400,
        'Project ID, Task ID, and deliverableUrl are required'
      );
    }

    const task = await submitTaskDeliverable(userId, projectId, taskId, {
      deliverableUrl,
      deliverableNote,
    });
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Task deliverable submitted for review',
      data: task,
      task,
    });
  }
);

export const approveTaskDeliverableController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    const taskId = getParamString(req.params.taskId);
    const { approved, feedback } = req.body;
    if (!projectId || !taskId || typeof approved !== 'boolean') {
      throw new ApiError(
        400,
        'Project ID, Task ID, and boolean approved flag are required'
      );
    }

    const task = await approveTaskDeliverable(
      userId,
      projectId,
      taskId,
      approved,
      feedback
    );
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: approved
        ? 'Deliverable approved; task marked completed'
        : 'Deliverable rejected with feedback requested',
      data: task,
      task,
    });
  }
);

export const addProjectResourceController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    if (!projectId) throw new ApiError(400, 'Project ID is required');

    const resource = await addProjectResource(userId, projectId, req.body);
    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: 'Project resource uploaded successfully',
      data: resource,
      resource,
    });
  }
);

export const getProjectResourcesController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    if (!projectId) throw new ApiError(400, 'Project ID is required');

    const resources = await getProjectResources(userId, projectId);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Project resources retrieved successfully',
      data: resources,
      resources,
    });
  }
);

export const deleteProjectResourceController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    const resourceId = getParamString(req.params.resourceId);
    if (!projectId || !resourceId) {
      throw new ApiError(400, 'Project ID and Resource ID are required');
    }

    const result = await deleteProjectResource(userId, projectId, resourceId);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: result.message,
    });
  }
);
