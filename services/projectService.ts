import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { OrgRole, ProjectRole, ProjectStatus, ProjectTaskStatus, TaskPriority } from '@prisma/client';
import { queueNotification } from '../queues/notificationQueue.js';
import { addProjectInviteEmailToQueue } from '../queues/emailQueue.js';
import { getIO } from '../sockets/socketServer.js';
import { PROJECT_EVENTS } from '../utils/constants.js';
import logger from '../utils/logger.js';

const emitToProject = async (projectId: string, event: string, payload: any) => {
  try {
    const io = getIO();
    if (!io) return;

    const conversation = await prisma.conversation.findUnique({
      where: { projectId },
      select: { id: true },
    });

    if (conversation) {
      io.to(`conversation:${conversation.id}`).emit(event, payload);
    }
  } catch (err: any) {
    logger.debug('Failed to emit project socket event', { projectId, event, error: err.message });
  }
};

const emitToUser = (userId: string, event: string, payload: any) => {
  try {
    const io = getIO();
    if (io) {
      io.to(`user:${userId}`).emit(event, payload);
    }
  } catch (err: any) {
    logger.debug('Failed to emit user socket event', { userId, event, error: err.message });
  }
};

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
  companyId?: string | null;
  companyName?: string;
}

export interface UpdateProjectMemberInput {
  role?: ProjectRole;
  hourlyRate?: number | null;
  companyId?: string | null;
  companyName?: string | null;
}

export interface CreateProjectResourceInput {
  title: string;
  fileUrl: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
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
            company: {
              select: { id: true, name: true, slug: true, logo: true },
            },
          },
        },
      },
    });

    const conversation = await tx.conversation.create({
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
      select: {
        id: true,
        type: true,
        name: true,
      },
    });

    return {
      ...createdProject,
      conversation,
      conversationId: conversation.id,
    };
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

  if (!orgMember || orgMember.role !== OrgRole.ORG_ADMIN) {
    const projectMemberships = await prisma.projectMember.findMany({
      where: {
        userId,
        project: { organizationId },
      },
      include: {
        project: {
          include: {
            _count: {
              select: { members: true, tasks: true, resources: true },
            },
            createdBy: {
              select: { id: true, name: true, email: true, avatar: true },
            },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return projectMemberships.map((pm) => ({
      ...pm.project,
      myRole: pm.role,
    }));
  }

  const projects = await prisma.project.findMany({
    where: { organizationId },
    include: {
      _count: {
        select: { members: true, tasks: true, resources: true },
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
    myRole: p.members[0]?.role || ProjectRole.PROJECT_MANAGER,
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
            select: { members: true, tasks: true, resources: true },
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
          company: {
            select: { id: true, name: true, slug: true, logo: true },
          },
        },
        orderBy: { joinedAt: 'asc' },
      },
      conversation: {
        select: { id: true },
      },
      _count: {
        select: { tasks: true, members: true, resources: true },
      },
    },
  });

  if (!project) {
    throw new ApiError(404, 'Project not found');
  }

  const myMembership = project.members.find((m) => m.userId === userId);
  let resolvedRole: ProjectRole;

  if (myMembership) {
    resolvedRole = myMembership.role;
  } else {
    const orgAdmin = await prisma.organizationMember.findFirst({
      where: {
        organizationId: project.organizationId,
        userId,
        role: OrgRole.ORG_ADMIN,
      },
    });

    if (!orgAdmin) {
      throw new ApiError(403, 'You do not have access to this project');
    }

    resolvedRole = ProjectRole.PROJECT_MANAGER;
  }

  return {
    ...project,
    myRole: resolvedRole,
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

  await prisma.projectInvite.deleteMany({
    where: {
      projectId,
      email,
      isAccepted: false,
      expiresAt: { lte: new Date() },
    },
  });

  const existingPendingInvite = await prisma.projectInvite.findFirst({
    where: {
      projectId,
      email,
      isAccepted: false,
      expiresAt: { gt: new Date() },
    },
  });

  if (existingPendingInvite) {
    throw new ApiError(400, 'A pending invitation has already been sent to this email address');
  }

  let companyName = input.companyName?.trim() || null;
  if (input.companyId) {
    const companyOrg = await prisma.organization.findUnique({
      where: { id: input.companyId },
      select: { id: true, name: true },
    });
    if (!companyOrg) {
      throw new ApiError(404, 'Collaborating company organization not found');
    }
    companyName = companyOrg.name;
  }

  const targetUser = await prisma.user.findUnique({ where: { email } });
  if (input.companyId && targetUser) {
    const isCompanyMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: input.companyId,
          userId: targetUser.id,
        },
      },
    });

    if (!isCompanyMember) {
      throw new ApiError(
        400,
        'The invited user is not a verified member of the specified collaborating organization'
      );
    }
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  let invite;
  try {
    invite = await prisma.projectInvite.create({
      data: {
        projectId,
        email,
        role: input.role || ProjectRole.FREELANCER,
        token,
        inviterId: userId,
        companyId: input.companyId || null,
        companyName,
        expiresAt,
      },
      include: {
        company: {
          select: { id: true, name: true, slug: true, logo: true },
        },
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002' || err?.message?.includes('ProjectInvite_active_email_key')) {
      throw new ApiError(400, 'A pending invitation has already been sent to this email address');
    }
    throw err;
  }

  const inviter = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const inviteUrl = `${process.env.APP_URL || 'https://app.quorum.me'}/projects/join?token=${token}`;

  try {
    await addProjectInviteEmailToQueue({
      email,
      inviterName: inviter?.name || 'A team member',
      projectName: project.name,
      orgName: project.organization.name,
      role: input.role || ProjectRole.FREELANCER,
      inviteLink: inviteUrl,
      expiresInDays: 7,
      companyName: companyName || undefined,
    });
  } catch (err: any) {
    await prisma.projectInvite.delete({ where: { id: invite.id } }).catch(() => {});
    logger.error('Failed to queue project invite email', { error: err.message });
    throw new ApiError(500, 'Failed to queue invitation email. Please try again.');
  }

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
    token: invite.token,
    inviteUrl,
  };
};

export const acceptProjectInvite = async (userId: string, token: string) => {
  const invite = await prisma.projectInvite.findUnique({
    where: { token },
    include: {
      project: {
        include: { conversation: { select: { id: true } } },
      },
      company: {
        select: { id: true, name: true, slug: true, logo: true },
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

  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw new ApiError(403, 'This invitation was issued to a different email address');
  }

  if (invite.companyId) {
    const isCompanyMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: invite.companyId,
          userId,
        },
      },
    });

    if (!isCompanyMember) {
      throw new ApiError(
        403,
        'You must be a verified member of the designated partner company to accept this invitation'
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedInvite = await tx.projectInvite.updateMany({
      where: {
        id: invite.id,
        isAccepted: false,
        expiresAt: { gt: new Date() },
      },
      data: { isAccepted: true },
    });

    if (updatedInvite.count === 0) {
      throw new ApiError(400, 'This invite token has already been accepted or has expired');
    }

    const existingMember = await tx.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: invite.projectId,
          userId,
        },
      },
    });

    if (existingMember) {
      throw new ApiError(400, 'You are already a member of this project');
    }

    const member = await tx.projectMember.create({
      data: {
        projectId: invite.projectId,
        userId,
        role: invite.role,
        companyId: invite.companyId,
        companyName: invite.companyName,
      },
      include: {
        project: { select: { id: true, name: true } },
        company: { select: { id: true, name: true, slug: true, logo: true } },
      },
    });

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

  emitToProject(invite.projectId, PROJECT_EVENTS.PROJECT_MEMBER_JOINED, {
    projectId: invite.projectId,
    member: result,
  });
  emitToUser(userId, PROJECT_EVENTS.PROJECT_MEMBER_JOINED, {
    projectId: invite.projectId,
    member: result,
  });

  return {
    message: `Successfully joined ${invite.project.name}`,
    member: result,
  };
};

export const getProjectInvitePreview = async (token: string) => {
  const invite = await prisma.projectInvite.findUnique({
    where: { token },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          description: true,
          organization: { select: { id: true, name: true, logo: true } },
        },
      },
      inviter: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      company: {
        select: { id: true, name: true, slug: true, logo: true },
      },
    },
  });

  if (!invite) {
    throw new ApiError(404, 'Invalid or expired project invite token');
  }

  const isExpired = new Date() > invite.expiresAt;

  return {
    id: invite.id,
    projectId: invite.projectId,
    projectName: invite.project.name,
    projectDescription: invite.project.description,
    organization: invite.project.organization,
    inviter: invite.inviter,
    role: invite.role,
    company: invite.company,
    companyName: invite.companyName,
    email: invite.email,
    isAccepted: invite.isAccepted,
    isExpired,
    expiresAt: invite.expiresAt,
  };
};

export const updateProjectMember = async (
  userId: string,
  projectId: string,
  targetUserId: string,
  input: UpdateProjectMemberInput
) => {
  await verifyProjectAdminAccess(userId, projectId);

  const existingMember = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: targetUserId,
      },
    },
  });

  if (!existingMember) {
    throw new ApiError(404, 'Member not found in this project');
  }

  let companyName = input.companyName !== undefined ? (input.companyName ? input.companyName.trim() : null) : undefined;
  if (input.companyId) {
    const companyOrg = await prisma.organization.findUnique({
      where: { id: input.companyId },
      select: { id: true, name: true },
    });
    if (!companyOrg) {
      throw new ApiError(404, 'Collaborating company organization not found');
    }
    const isCompanyMember = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: input.companyId,
          userId: targetUserId,
        },
      },
    });
    if (!isCompanyMember) {
      throw new ApiError(
        400,
        'The user is not a verified member of the specified collaborating organization'
      );
    }
    companyName = companyOrg.name;
  } else if (input.companyId === null) {
    companyName = null;
  }

  const updatedMember = await prisma.projectMember.update({
    where: {
      projectId_userId: {
        projectId,
        userId: targetUserId,
      },
    },
    data: {
      ...(input.role && { role: input.role }),
      ...(input.hourlyRate !== undefined && { hourlyRate: input.hourlyRate }),
      ...(input.companyId !== undefined && { companyId: input.companyId }),
      ...(companyName !== undefined && { companyName }),
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      company: {
        select: { id: true, name: true, slug: true, logo: true },
      },
    },
  });

  return updatedMember;
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
    await tx.projectTask.updateMany({
      where: {
        projectId,
        assigneeId: targetUserId,
      },
      data: {
        assigneeId: null,
      },
    });

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

  emitToProject(projectId, PROJECT_EVENTS.PROJECT_MEMBER_REMOVED, {
    projectId,
    userId: targetUserId,
  });
  emitToUser(targetUserId, PROJECT_EVENTS.PROJECT_MEMBER_REMOVED, {
    projectId,
    userId: targetUserId,
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

  emitToProject(projectId, PROJECT_EVENTS.TASK_CREATED, { projectId, task });
  if (input.assigneeId) {
    emitToUser(input.assigneeId, PROJECT_EVENTS.TASK_CREATED, { projectId, task });
  }

  return task;
};

export const getProjectTasks = async (
  userId: string,
  projectId: string,
  status?: string,
  assigneeId?: string
) => {
  await verifyProjectMemberAccess(userId, projectId);

  if (status && !Object.values(ProjectTaskStatus).includes(status as ProjectTaskStatus)) {
    throw new ApiError(
      400,
      `Invalid task status: "${status}". Valid values are: ${Object.values(ProjectTaskStatus).join(', ')}`
    );
  }

  return await prisma.projectTask.findMany({
    where: {
      projectId,
      ...(status && { status: status as ProjectTaskStatus }),
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
  const member = await verifyProjectMemberAccess(userId, projectId);

  const task = await prisma.projectTask.findUnique({
    where: { id: taskId, projectId },
  });

  if (!task) {
    throw new ApiError(404, 'Task not found');
  }

  const isManagerOrAdmin =
    member.role === ProjectRole.PROJECT_MANAGER || (member as any).isOrgAdmin;
  const isCreator = task.createdById === userId;
  const isAssignee = task.assigneeId === userId;

  if (!isManagerOrAdmin) {
    if (
      input.status &&
      (input.status === ProjectTaskStatus.COMPLETED || input.status === ProjectTaskStatus.CANCELLED)
    ) {
      throw new ApiError(
        403,
        'Only project managers can mark tasks as completed or cancelled. Please submit a deliverable for review instead.'
      );
    }

    if (!isCreator) {
      if (!isAssignee) {
        throw new ApiError(403, 'You do not have permission to modify this task');
      }

      if (
        input.assigneeId !== undefined ||
        input.priority !== undefined ||
        input.title !== undefined ||
        input.dueDate !== undefined
      ) {
        throw new ApiError(
          403,
          'Only project managers or the task creator can modify task assignment, priority, title, or due date'
        );
      }
    }
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

  if (input.status === ProjectTaskStatus.IN_REVIEW && !task.deliverableUrl) {
    throw new ApiError(
      400,
      'Cannot set task to IN_REVIEW without submitting a deliverable URL'
    );
  }

  const dueDate = input.dueDate !== undefined ? (input.dueDate ? new Date(input.dueDate) : null) : undefined;

  const updatedTask = await prisma.projectTask.update({
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

  emitToProject(projectId, PROJECT_EVENTS.TASK_UPDATED, { projectId, task: updatedTask });
  if (updatedTask.assigneeId) {
    emitToUser(updatedTask.assigneeId, PROJECT_EVENTS.TASK_UPDATED, { projectId, task: updatedTask });
  }

  return updatedTask;
};

export const updateProjectTaskStatus = async (
  userId: string,
  projectId: string,
  taskId: string,
  status: ProjectTaskStatus
) => {
  const member = await verifyProjectMemberAccess(userId, projectId);

  const task = await prisma.projectTask.findUnique({
    where: { id: taskId, projectId },
  });

  if (!task) {
    throw new ApiError(404, 'Task not found');
  }

  const isManagerOrAdmin =
    member.role === ProjectRole.PROJECT_MANAGER || (member as any).isOrgAdmin;
  const isCreator = task.createdById === userId;
  const isAssignee = task.assigneeId === userId;

  if (!isManagerOrAdmin && !isCreator && !isAssignee) {
    throw new ApiError(
      403,
      'Only the task assignee, creator, or project managers can change the task status'
    );
  }

  if (!isManagerOrAdmin) {
    if (status === ProjectTaskStatus.COMPLETED || status === ProjectTaskStatus.CANCELLED) {
      throw new ApiError(
        403,
        'Only project managers can mark tasks as completed or cancelled. Please submit a deliverable for review instead.'
      );
    }
  }

  if (status === ProjectTaskStatus.IN_REVIEW && !task.deliverableUrl) {
    throw new ApiError(
      400,
      'Cannot set task to IN_REVIEW without submitting a deliverable URL'
    );
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

  emitToProject(projectId, PROJECT_EVENTS.TASK_STATUS_CHANGED, {
    projectId,
    taskId,
    status,
    task: updatedTask,
  });
  if (updatedTask.assigneeId) {
    emitToUser(updatedTask.assigneeId, PROJECT_EVENTS.TASK_STATUS_CHANGED, {
      projectId,
      taskId,
      status,
      task: updatedTask,
    });
  }

  return updatedTask;
};

export const submitTaskDeliverable = async (
  userId: string,
  projectId: string,
  taskId: string,
  input: { deliverableUrl: string; deliverableNote?: string }
) => {
  const member = await verifyProjectMemberAccess(userId, projectId);

  const task = await prisma.projectTask.findUnique({
    where: { id: taskId, projectId },
    include: { project: { select: { createdById: true } } },
  });

  if (!task) {
    throw new ApiError(404, 'Task not found');
  }

  if (task.status === ProjectTaskStatus.COMPLETED || task.status === ProjectTaskStatus.CANCELLED) {
    throw new ApiError(400, 'Cannot submit deliverable: task is already completed or cancelled');
  }

  const isManagerOrAdmin =
    member.role === ProjectRole.PROJECT_MANAGER || (member as any).isOrgAdmin;
  const isAssignee = task.assigneeId === userId;

  if (!isAssignee && !isManagerOrAdmin) {
    throw new ApiError(403, 'Only the assigned member can submit deliverables for this task');
  }

  const updated = await prisma.projectTask.update({
    where: { id: taskId },
    data: {
      status: ProjectTaskStatus.IN_REVIEW,
      deliverableUrl: input.deliverableUrl.trim(),
      deliverableNote: input.deliverableNote?.trim() || null,
    },
  });

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

  emitToProject(projectId, PROJECT_EVENTS.DELIVERABLE_SUBMITTED, {
    projectId,
    taskId,
    deliverableUrl: updated.deliverableUrl,
    deliverableNote: updated.deliverableNote,
    task: updated,
  });
  emitToUser(task.project.createdById, PROJECT_EVENTS.DELIVERABLE_SUBMITTED, {
    projectId,
    taskId,
    deliverableUrl: updated.deliverableUrl,
    deliverableNote: updated.deliverableNote,
    task: updated,
  });

  return updated;
};

export const approveTaskDeliverable = async (
  userId: string,
  projectId: string,
  taskId: string,
  approved: boolean = true,
  feedback?: string
) => {
  await verifyProjectAdminAccess(userId, projectId);

  const task = await prisma.projectTask.findUnique({
    where: { id: taskId, projectId },
  });

  if (!task) {
    throw new ApiError(404, 'Task not found');
  }

  if (!task.deliverableUrl) {
    throw new ApiError(400, 'Cannot approve task: no deliverable has been submitted for this task');
  }

  if (task.status !== ProjectTaskStatus.IN_REVIEW) {
    throw new ApiError(400, 'Cannot approve task: task is not currently awaiting review');
  }

  const updatedTask = await prisma.projectTask.update({
    where: { id: taskId },
    data: {
      status: approved ? ProjectTaskStatus.COMPLETED : ProjectTaskStatus.IN_PROGRESS,
      ...(!approved && { deliverableUrl: null }),
    },
  });

  if (task.assigneeId) {
    try {
      await queueNotification({
        recipientId: task.assigneeId,
        actorId: userId,
        type: 'DIRECT_MESSAGE',
        title: approved ? 'Task Approved! 🎉' : 'Changes Requested on Deliverable',
        body: approved
          ? `Your work on "${task.title}" has been approved!`
          : `Changes requested on "${task.title}": ${feedback || 'Please revise your submission.'}`,
        data: { projectId, taskId, status: approved ? 'COMPLETED' : 'IN_PROGRESS' },
      });
    } catch (err: any) {
      logger.warn('Failed to notify freelancer of deliverable review', { error: err.message });
    }
  }

  emitToProject(projectId, PROJECT_EVENTS.DELIVERABLE_REVIEWED, {
    projectId,
    taskId,
    approved,
    feedback,
    task: updatedTask,
  });
  if (task.assigneeId) {
    emitToUser(task.assigneeId, PROJECT_EVENTS.DELIVERABLE_REVIEWED, {
      projectId,
      taskId,
      approved,
      feedback,
      task: updatedTask,
    });
  }

  return updatedTask;
};

export const addProjectResource = async (
  userId: string,
  projectId: string,
  input: CreateProjectResourceInput
) => {
  await verifyProjectMemberAccess(userId, projectId);

  const resource = await prisma.projectResource.create({
    data: {
      projectId,
      title: input.title.trim(),
      fileUrl: input.fileUrl.trim(),
      fileName: input.fileName?.trim() || null,
      fileType: input.fileType?.trim() || null,
      fileSize: input.fileSize || null,
      uploadedById: userId,
    },
    include: {
      uploadedBy: {
        select: { id: true, name: true, email: true, avatar: true },
      },
    },
  });

  emitToProject(projectId, 'project:resource_added', { projectId, resource });

  return resource;
};

export const getProjectResources = async (userId: string, projectId: string) => {
  await verifyProjectMemberAccess(userId, projectId);

  return await prisma.projectResource.findMany({
    where: { projectId },
    include: {
      uploadedBy: {
        select: { id: true, name: true, email: true, avatar: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
};

export const deleteProjectResource = async (
  userId: string,
  projectId: string,
  resourceId: string
) => {
  const member = await verifyProjectMemberAccess(userId, projectId);

  const resource = await prisma.projectResource.findUnique({
    where: { id: resourceId, projectId },
  });

  if (!resource) {
    throw new ApiError(404, 'Resource not found');
  }

  const isManagerOrAdmin =
    member.role === ProjectRole.PROJECT_MANAGER || (member as any).isOrgAdmin;
  const isUploader = resource.uploadedById === userId;

  if (!isManagerOrAdmin && !isUploader) {
    throw new ApiError(403, 'You do not have permission to delete this resource');
  }

  await prisma.projectResource.delete({
    where: { id: resourceId },
  });

  emitToProject(projectId, 'project:resource_deleted', { projectId, resourceId });

  return { message: 'Resource deleted successfully' };
};

export const verifyProjectMemberAccess = async (userId: string, projectId: string) => {
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
    throw new ApiError(403, 'You do not have access to this project');
  }

  return {
    role: ProjectRole.PROJECT_MANAGER,
    isOrgAdmin: true,
    isOrgMember: true,
  };
};

export const verifyProjectAdminAccess = async (userId: string, projectId: string) => {
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

  return { role: ProjectRole.PROJECT_MANAGER, isOrgAdmin: true };
};
