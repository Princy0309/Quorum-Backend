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
  removeProjectMember,
  createProjectTask,
  getProjectTasks,
  updateProjectTask,
  updateProjectTaskStatus,
  submitTaskDeliverable,
  approveTaskDeliverable,
} from '../services/projectService.js';
import { ProjectTaskStatus } from '@prisma/client';

const getParamString = (param: unknown): string | undefined => {
  if (Array.isArray(param)) return param[0];
  if (typeof param === 'string') return param;
  return undefined;
};

// 1. Create a new Project
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

// 2. Get Organization Projects
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

// 3. Get User Projects (all projects where user is internal member or external freelancer)
export const getUserProjectsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

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

// 4. Get Project Details
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

// 5. Update Project Details
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

// 6. Delete Project
export const deleteProjectController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    if (!projectId) throw new ApiError(400, 'Project ID is required');

    await deleteProject(userId, projectId);
    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: 'Project deleted successfully',
    });
  }
);

// 7. Invite Member to Project (External Freelancer or Internal Member)
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

// 8. Accept Project Invite
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

// 9. Remove Member from Project
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

// 10. Create Project Task
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

// 11. Get Project Tasks
export const getProjectTasksController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, 'Unauthorized');

    const projectId =
      getParamString(req.params.projectId) || getParamString(req.params.id);
    if (!projectId) throw new ApiError(400, 'Project ID is required');

    const statusParam = getParamString(req.query.status) as ProjectTaskStatus | undefined;
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

// 12. Update Project Task
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

// 13. Update Project Task Status
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

// 14. Submit Task Deliverable (Freelancer)
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

// 15. Approve or Reject Task Deliverable (Project Manager / Org Admin)
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
