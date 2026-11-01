import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { OrgRole, ProjectRole, ProjectStatus, ProjectTaskStatus, TaskPriority } from '@prisma/client';
import { queueNotification } from '../queues/notificationQueue.js';
import logger from '../utils/logger.js';

export interface CreateProjectInput {
  name: string;
  description?: string;
  budget?: number;
  dueDate?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  budget?: number;
  dueDate?: string | null;
}

export interface InviteProjectMemberInput {
  email: string;
  role?: ProjectRole;
  hourlyRate?: number;
  companyName?: string;
}

export interface CreateProjectTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  assigneeId?: string | null;
}

export interface UpdateProjectTaskInput {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: ProjectTaskStatus;
  dueDate?: string | null;
  assigneeId?: string | null;
}

export const createProject = async (
  userId: string,
  organizationId: string,
  input: CreateProjectInput
) => {
  const orgMember = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId,
      },
    },
  });

  if (!orgMember || (orgMember.role !== OrgRole.ORG_ADMIN && orgMember.role !== OrgRole.TEAM_HEAD)) {
    throw new ApiError(403, 'Only organization admins and team leads can create projects');
  }

  const dueDate = input.dueDate ? new Date(input.dueDate) : null;

  const project = await prisma.$transaction(async (tx) => {
    const createdProject = await tx.project.create({
      data: {
        organizationId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        budget: input.budget || null,
        dueDate,
        createdById: userId,
        status: ProjectStatus.ACTIVE,
        members: {
          create: {
            userId,
            role: ProjectRole.PROJECT_MANAGER,
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
      },
    });

    // Create a linked conversation for project-wide real-time collaboration
    await tx.conversation.create({
      data: {
        type: 'project',
        name: createdProject.name,
        projectId: createdProject.id,
        ownerId: userId,
        participants: {
          create: {
            userId,
            role: 'admin',
          },
        },
      },
    });

    return createdProject;
  });

  return project;
};

export const getOrganizationProjects = async (userId: string, organizationId: string) => {
  const orgMember = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId,
      },
    },
  });

  if (!orgMember) {
    // If not a full organization member, check if user is an external collaborator on any project in this org
    const projectMemberships = await prisma.projectMember.findMany({
      where: {
        userId,
        project: { organizationId },
      },
      include: {
        project: {
          include: {
            _count: {
              select: { members: true, tasks: true },
            },
            createdBy: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
      },
    });

    return projectMemberships.map((pm) => ({
      ...pm.project,
      myRole: pm.role,
    }));
  }

  // Internal organization member: can view all organization projects
  const projects = await prisma.project.findMany({
    where: { organizationId },
    include: {
      _count: {
        select: { members: true, tasks: true },
      },
      createdBy: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      members: {
        where: { userId },
        select: { role: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return projects.map((p) => ({
    ...p,
    myRole: p.members[0]?.role || (orgMember.role === OrgRole.ORG_ADMIN ? ProjectRole.PROJECT_MANAGER : null),
  }));
};

export const getUserProjects = async (userId: string) => {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    include: {
      project: {
        include: {
          organization: {
            select: { id: true, name: true, slug: true, logo: true },
          },
          _count: {
            select: { members: true, tasks: true },
          },
        },
      },
    },
    orderBy: { joinedAt: 'desc' },
  });

  return memberships.map((m) => ({
    ...m.project,
    myRole: m.role,
  }));
};

export const getProjectDetails = async (userId: string, projectId: string) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      organization: {
        select: { id: true, name: true, slug: true, logo: true },
      },
      createdBy: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
        orderBy: { joinedAt: 'asc' },
      },
      conversation: {
        select: { id: true },
      },
      _count: {
        select: { tasks: true, members: true },
      },
    },
  });

  if (!project) {
    throw new ApiError(404, 'Project not found');
  }

  const isMember = project.members.some((m) => m.userId === userId);
  if (!isMember) {
    const orgMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId,
        },
      },
    });

    if (!orgMember || orgMember.role !== OrgRole.ORG_ADMIN) {
      throw new ApiError(403, 'You do not have access to this project');
    }
  }

  const myMembership = project.members.find((m) => m.userId === userId);

  return {
    ...project,
    myRole: myMembership?.role || ProjectRole.PROJECT_MANAGER,
    conversationId: project.conversation?.id || null,
  };
};

export const updateProject = async (
  userId: string,
  projectId: string,
  input: UpdateProjectInput
) => {
  await verifyProjectAdminAccess(userId, projectId);

  const dueDate = input.dueDate !== undefined ? (input.dueDate ? new Date(input.dueDate) : null) : undefined;

  return await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name && { name: input.name.trim() }),
      ...(input.description !== undefined && { description: input.description?.trim() || null }),
      ...(input.status && { status: input.status }),
      ...(input.budget !== undefined && { budget: input.budget }),
      ...(dueDate !== undefined && { dueDate }),
    },
  });
};

export const deleteProject = async (userId: string, projectId: string) => {
  await verifyProjectAdminAccess(userId, projectId);

  await prisma.project.delete({
    where: { id: projectId },
  });

  return { message: 'Project deleted successfully' };
};

export const inviteProjectMember = async (
  userId: string,
  projectId: string,
  input: InviteProjectMemberInput
) => {
  await verifyProjectAdminAccess(userId, projectId);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, organization: { select: { name: true } } },
  });

  if (!project) {
    throw new ApiError(404, 'Project not found');
  }

  const email = input.email.trim().toLowerCase();

  const existingMember = await prisma.projectMember.findFirst({
    where: {
      projectId,
      user: { email },
    },
  });

  if (existingMember) {
    throw new ApiError(400, 'User is already a member of this project');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invite = await prisma.projectInvite.create({
    data: {
      projectId,
      email,
      role: input.role || ProjectRole.FREELANCER,
      token,
      inviterId: userId,
      expiresAt,
    },
  });

  // If the user already has an account, queue an in-app and push notification
  const targetUser = await prisma.user.findUnique({ where: { email } });
  if (targetUser) {
    try {
      await queueNotification({
        recipientId: targetUser.id,
        actorId: userId,
        type: 'ORG_INVITE',
        title: `Project Invitation: ${project.name}`,
        body: `You have been invited to collaborate on "${project.name}" by ${project.organization.name}.`,
        data: { projectId, token, type: 'PROJECT_INVITE' },
      });
    } catch (err: any) {
      logger.warn('Failed to queue project invite notification', { error: err.message });
    }
  }

  return {
    invite,
    inviteUrl: `${process.env.APP_URL || 'https://app.quorum.me'}/projects/join?token=${token}`,
  };
};

export const acceptProjectInvite = async (userId: string, token: string) => {
  const invite = await prisma.projectInvite.findUnique({
    where: { token },
    include: {
      project: {
        include: { conversation: { select: { id: true } } },
      },
    },
  });

  if (!invite) {
    throw new ApiError(404, 'Invalid or expired project invite token');
  }

  if (invite.isAccepted) {
    throw new ApiError(400, 'This invite token has already been used');
  }

  if (new Date() > invite.expiresAt) {
    throw new ApiError(400, 'This invite has expired');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Mark invite accepted
    await tx.projectInvite.update({
      where: { id: invite.id },
      data: { isAccepted: true },
    });

    // 2. Add as Project Member
    const member = await tx.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId: invite.projectId,
          userId,
        },
      },
      update: { role: invite.role },
      create: {
        projectId: invite.projectId,
        userId,
        role: invite.role,
      },
      include: {
        project: { select: { id: true, name: true } },
      },
    });

    // 3. Add to project group conversation
    if (invite.project.conversation?.id) {
      await tx.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId: invite.project.conversation.id,
            userId,
          },
        },
        update: {},
        create: {
          conversationId: invite.project.conversation.id,
          userId,
          role: 'member',
        },
      });
    }

    return member;
  });

  return {
    message: `Successfully joined ${invite.project.name}`,
    member: result,
  };
};

export const removeProjectMember = async (
  userId: string,
  projectId: string,
  targetUserId: string
) => {
  await verifyProjectAdminAccess(userId, projectId);

  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: targetUserId,
      },
    },
  });

  if (!member) {
    throw new ApiError(404, 'Member not found in this project');
  }

  if (member.userId === userId) {
    throw new ApiError(400, 'Cannot remove yourself using this endpoint. Use leave project instead.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.delete({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUserId,
        },
      },
    });

    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { conversation: { select: { id: true } } },
    });

    if (project?.conversation?.id) {
      await tx.conversationParticipant.deleteMany({
        where: {
          conversationId: project.conversation.id,
          userId: targetUserId,
        },
      });
    }
  });

  return { message: 'Member removed from project successfully' };
};

export const createProjectTask = async (
  userId: string,
  projectId: string,
  input: CreateProjectTaskInput
) => {
  await verifyProjectMemberAccess(userId, projectId);

  if (input.assigneeId) {
    const isAssigneeMember = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: input.assigneeId,
        },
      },
    });

    if (!isAssigneeMember) {
      throw new ApiError(400, 'Assignee must be a member of this project');
    }
  }

  const dueDate = input.dueDate ? new Date(input.dueDate) : null;

  const task = await prisma.projectTask.create({
    data: {
      projectId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      priority: input.priority || TaskPriority.MEDIUM,
      status: ProjectTaskStatus.TODO,
      dueDate,
      assigneeId: input.assigneeId || null,
      createdById: userId,
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

  if (input.assigneeId && input.assigneeId !== userId) {
    try {
      await queueNotification({
        recipientId: input.assigneeId,
        actorId: userId,
        type: 'DIRECT_MESSAGE',
        title: 'New Project Task Assigned',
        body: `You were assigned task: "${task.title}"`,
        data: { projectId, taskId: task.id, type: 'PROJECT_TASK' },
      });
    } catch (err: any) {
      logger.warn('Failed to queue task assignment notification', { error: err.message });
    }
  }

  return task;
};

export const getProjectTasks = async (
  userId: string,
  projectId: string,
  status?: ProjectTaskStatus,
  assigneeId?: string
) => {
  await verifyProjectMemberAccess(userId, projectId);

  return await prisma.projectTask.findMany({
    where: {
      projectId,
      ...(status && { status }),
      ...(assigneeId && { assigneeId }),
    },
    include: {
      assignee: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      createdBy: {
        select: { id: true, name: true, email: true, avatar: true },
      },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
};

export const updateProjectTask = async (
  userId: string,
  projectId: string,
  taskId: string,
  input: UpdateProjectTaskInput
) => {
  await verifyProjectMemberAccess(userId, projectId);

  const task = await prisma.projectTask.findUnique({
    where: { id: taskId, projectId },
  });

  if (!task) {
    throw new ApiError(404, 'Task not found');
  }

  if (input.assigneeId) {
    const isAssigneeMember = await prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: input.assigneeId,
        },
      },
    });

    if (!isAssigneeMember) {
      throw new ApiError(400, 'Assignee must be a member of this project');
    }
  }

  const dueDate = input.dueDate !== undefined ? (input.dueDate ? new Date(input.dueDate) : null) : undefined;

  return await prisma.projectTask.update({
    where: { id: taskId },
    data: {
      ...(input.title && { title: input.title.trim() }),
      ...(input.description !== undefined && { description: input.description?.trim() || null }),
      ...(input.priority && { priority: input.priority }),
      ...(input.status && { status: input.status }),
      ...(dueDate !== undefined && { dueDate }),
      ...(input.assigneeId !== undefined && { assigneeId: input.assigneeId }),
    },
    include: {
      assignee: {
        select: { id: true, name: true, email: true, avatar: true },
      },
    },
  });
};

export const updateProjectTaskStatus = async (
  userId: string,
  projectId: string,
  taskId: string,
  status: ProjectTaskStatus
) => {
  await verifyProjectMemberAccess(userId, projectId);

  const task = await prisma.projectTask.findUnique({
    where: { id: taskId, projectId },
  });

  if (!task) {
    throw new ApiError(404, 'Task not found');
  }

  const updatedTask = await prisma.projectTask.update({
    where: { id: taskId },
    data: { status },
    include: {
      assignee: {
        select: { id: true, name: true, email: true, avatar: true },
      },
    },
  });

  return updatedTask;
};

export const submitTaskDeliverable = async (
  userId: string,
  projectId: string,
  taskId: string,
  input: { deliverableUrl: string; deliverableNote?: string }
) => {
  await verifyProjectMemberAccess(userId, projectId);

  const task = await prisma.projectTask.findUnique({
    where: { id: taskId, projectId },
    include: { project: { select: { createdById: true } } },
  });

  if (!task) {
    throw new ApiError(404, 'Task not found');
  }

  const updated = await prisma.projectTask.update({
    where: { id: taskId },
    data: {
      status: ProjectTaskStatus.IN_REVIEW,
      deliverableUrl: input.deliverableUrl.trim(),
      deliverableNote: input.deliverableNote?.trim() || null,
    },
  });

  // Notify the project manager that deliverable is submitted
  try {
    await queueNotification({
      recipientId: task.project.createdById,
      actorId: userId,
      type: 'DIRECT_MESSAGE',
      title: 'Task Deliverable Submitted for Review',
      body: `Deliverable submitted for "${task.title}".`,
      data: { projectId, taskId, status: 'IN_REVIEW' },
    });
  } catch (err: any) {
    logger.warn('Failed to notify project manager of deliverable submission', { error: err.message });
  }

  return updated;
};

export const approveTaskDeliverable = async (
  userId: string,
  projectId: string,
  taskId: string
) => {
  await verifyProjectAdminAccess(userId, projectId);

  const task = await prisma.projectTask.findUnique({
    where: { id: taskId, projectId },
  });

  if (!task) {
    throw new ApiError(404, 'Task not found');
  }

  const approved = await prisma.projectTask.update({
    where: { id: taskId },
    data: { status: ProjectTaskStatus.COMPLETED },
  });

  if (task.assigneeId) {
    try {
      await queueNotification({
        recipientId: task.assigneeId,
        actorId: userId,
        type: 'DIRECT_MESSAGE',
        title: 'Task Approved! 🎉',
        body: `Your work on "${task.title}" has been approved!`,
        data: { projectId, taskId, status: 'COMPLETED' },
      });
    } catch (err: any) {
      logger.warn('Failed to notify freelancer of deliverable approval', { error: err.message });
    }
  }

  return approved;
};

// Helper: Ensure user is a Project Member (or Org Admin)
const verifyProjectMemberAccess = async (userId: string, projectId: string) => {
  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId,
      },
    },
  });

  if (member) return member;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });

  if (!project) {
    throw new ApiError(404, 'Project not found');
  }

  const orgAdmin = await prisma.organizationMember.findFirst({
    where: {
      organizationId: project.organizationId,
      userId,
      role: OrgRole.ORG_ADMIN,
    },
  });

  if (!orgAdmin) {
    throw new ApiError(403, 'You are not a member of this project');
  }

  return { role: ProjectRole.PROJECT_MANAGER };
};

// Helper: Ensure user has Project Manager / Admin permissions
const verifyProjectAdminAccess = async (userId: string, projectId: string) => {
  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId,
      },
    },
  });

  if (member && member.role === ProjectRole.PROJECT_MANAGER) {
    return member;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });

  if (!project) {
    throw new ApiError(404, 'Project not found');
  }

  const orgAdmin = await prisma.organizationMember.findFirst({
    where: {
      organizationId: project.organizationId,
      userId,
      role: OrgRole.ORG_ADMIN,
    },
  });

  if (!orgAdmin) {
    throw new ApiError(403, 'Only project managers or organization admins can perform this action');
  }

  return { role: ProjectRole.PROJECT_MANAGER };
};
