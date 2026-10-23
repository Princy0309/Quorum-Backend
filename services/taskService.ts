import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { OrgRole, TaskStatus } from '@prisma/client';
import { queueNotification } from '../queues/notificationQueue.js';
import logger from '../utils/logger.js';

interface CreateTaskInput {
  title: string;
  description?: string;
  dueDate?: string | Date;
  assigneeId: string;
}


export const createTask = async (
  organizationId: string,
  teamId: string,
  createdById: string,
  input: CreateTaskInput
) => {
  const { title, description, dueDate, assigneeId } = input;

  if (!title || title.trim().length === 0) {
    throw new ApiError(400, 'Task title is required');
  }

  if (!assigneeId) {
    throw new ApiError(400, 'Assignee ID is required');
  }

  let parsedDueDate: Date | null = null;
  if (dueDate) {
    const parsed = new Date(dueDate);
    if (isNaN(parsed.getTime())) {
      throw new ApiError(400, 'Invalid dueDate format. Please provide a valid ISO date');
    }
    parsedDueDate = parsed;
  }


  const team = await prisma.team.findFirst({
    where: { id: teamId, organizationId },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found in this organization');
  }

  
  const isTeamMember = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: assigneeId,
      },
    },
  });

  if (!isTeamMember) {
    throw new ApiError(400, 'Assignee must be a member of this specific team');
  }

 
  const task = await prisma.teamTask.create({
    data: {
      teamId,
      title: title.trim(),
      description: description?.trim() || null,
      dueDate: parsedDueDate,
      assigneeId,
      createdById,
      status: TaskStatus.TODO,
    },
    include: {
      assignee: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      createdBy: {
        select: { id: true, name: true, email: true, avatar: true },
      },
    },
  });

  try {
    await queueNotification({
      recipientId: assigneeId,
      actorId: createdById,
      type: 'SYSTEM',
      title: 'New Task Assigned',
      body: `You have been assigned: "${task.title}" in team ${team.name}`,
      data: { taskId: task.id, teamId, organizationId },
    });
  } catch (err: any) {
    logger.warn('Failed to queue task notification:', err?.message);
  }

  return task;
};

export const getTeamTasks = async (organizationId: string, teamId: string) => {
  const team = await prisma.team.findFirst({
    where: { id: teamId, organizationId },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found in this organization');
  }

  return await prisma.teamTask.findMany({
    where: { teamId },
    orderBy: { createdAt: 'desc' },
    include: {
      assignee: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      createdBy: {
        select: { id: true, name: true, email: true, avatar: true },
      },
    },
  });
};


export const updateTaskStatus = async (
  organizationId: string,
  teamId: string,
  taskId: string,
  userId: string,
  userOrgRole: OrgRole,
  status: string
) => {
 
  if (!Object.values(TaskStatus).includes(status as TaskStatus)) {
    throw new ApiError(
      400,
      `Invalid status. Must be one of: ${Object.values(TaskStatus).join(', ')}`
    );
  }

  const task = await prisma.teamTask.findUnique({
    where: { id: taskId },
    include: { team: true },
  });

  if (!task || task.teamId !== teamId || task.team.organizationId !== organizationId) {
    throw new ApiError(404, 'Task not found in this team');
  }

  
  const isAssignee = task.assigneeId === userId;
  
  const isOrgAdmin = userOrgRole === OrgRole.ORG_ADMIN;
  
  const userTeamMember = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
  });
  const isTeamLead = userTeamMember?.role === 'LEAD' || userOrgRole === OrgRole.TEAM_HEAD;

  if (!isAssignee && !isOrgAdmin && !isTeamLead) {
    throw new ApiError(403, 'Only the assignee, team lead, or org admin can update this task');
  }

  return await prisma.teamTask.update({
    where: { id: taskId },
    data: { status: status as TaskStatus },
    include: {
      assignee: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      createdBy: {
        select: { id: true, name: true, email: true, avatar: true },
      },
    },
  });
};

export const getMyTasks = async (organizationId: string, userId: string) => {
  return await prisma.teamTask.findMany({
    where: {
      assigneeId: userId,
      team: { organizationId },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      team: {
        select: { id: true, name: true },
      },
      createdBy: {
        select: { id: true, name: true, email: true, avatar: true },
      },
    },
  });
};
