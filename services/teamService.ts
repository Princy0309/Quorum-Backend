import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import type { CreateTeamInput, UpdateTeamInput } from '../types/team.js';
import { queueNotification } from '../queues/notificationQueue.js';
import logger from '../utils/logger.js';


export const createTeam = async (
  organizationId: string,
  creatorUserId: string,
  data: CreateTeamInput
) => {
  const { name, description } = data;

  if (!name || name.trim().length === 0) {
    throw new ApiError(400, 'Team name is required');
  }

  const trimmedName = name.trim();


  const existingTeam = await prisma.team.findUnique({
    where: {
      organizationId_name: {
        organizationId,
        name: trimmedName,
      },
    },
  });

  if (existingTeam) {
    throw new ApiError(409, 'A team with this name already exists in this organization');
  }

  return await prisma.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: {
        organizationId,
        name: trimmedName,
        description: description?.trim() || null,
      },
    });

    await tx.teamMember.create({
      data: {
        teamId: team.id,
        userId: creatorUserId,
        role: 'LEAD',
      },
    });


    await tx.conversation.create({
      data: {
        type: 'team',
        teamId: team.id,
        name: team.name,
        ownerId: creatorUserId,
        participants: {
          create: {
            userId: creatorUserId,
            role: 'admin',
          },
        },
      },
    });

    return team;
  });

};

export const getOrganizationTeams = async (organizationId: string) => {
  const teams = await prisma.team.findMany({
    where: { organizationId },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
      },
      _count: {
        select: { members: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    description: team.description,
    organizationId: team.organizationId,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    memberCount: team._count.members,
    members: team.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user,
    })),
  }));
};

export const getTeamById = async (organizationId: string, teamId: string) => {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      organizationId,
    },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
      },
      _count: {
        select: { members: true },
      },
    },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found in this organization');
  }

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    organizationId: team.organizationId,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    memberCount: team._count.members,
    members: team.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      user: m.user,
    })),
  };
};


export const updateTeam = async (
  organizationId: string,
  teamId: string,
  data: UpdateTeamInput
) => {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      organizationId,
    },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found in this organization');
  }

  const { name, description } = data;
  const updateData: { name?: string; description?: string | null } = {};

  if (name !== undefined) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new ApiError(400, 'Team name cannot be empty');
    }

    const duplicate = await prisma.team.findFirst({
      where: {
        organizationId,
        name: trimmedName,
        NOT: { id: teamId },
      },
    });

    if (duplicate) {
      throw new ApiError(409, 'A team with this name already exists in this organization');
    }

    updateData.name = trimmedName;
  }

  if (description !== undefined) {
    updateData.description = description ? description.trim() : null;
  }

  return await prisma.team.update({
    where: { id: teamId },
    data: updateData,
  });
};

export const deleteTeam = async (organizationId: string, teamId: string) => {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      organizationId,
    },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found in this organization');
  }

  await prisma.team.delete({
    where: { id: teamId },
  });

  return { message: 'Team deleted successfully' };
};

export const addTeamMember = async (
  organizationId: string,
  teamId: string,
  targetUserId: string,
  role: string = 'member'
) => {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      organizationId,
    },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found in this organization');
  }

  const orgMember = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: targetUserId,
      },
    },
  });

  if (!orgMember) {
    throw new ApiError(400, 'User must be a member of the organization before joining a team');
  }

  const existingTeamMember = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: targetUserId,
      },
    },
  });

  if (existingTeamMember) {
    throw new ApiError(409, 'User is already a member of this team');
  }

  const createdMember = await prisma.teamMember.create({
    data: {
      teamId,
      userId: targetUserId,
      role: role.trim() || 'member',
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
    },
  });

  const teamConversation = await prisma.conversation.findUnique({
    where: { teamId },
  });

  if (teamConversation) {
    await prisma.conversationParticipant.upsert({
      where: {
        conversationId_userId: {
          conversationId: teamConversation.id,
          userId: targetUserId,
        },
      },
      create: {
        conversationId: teamConversation.id,
        userId: targetUserId,
        role: role === 'LEAD' ? 'admin' : 'member',
      },
      update: {
        role: role === 'LEAD' ? 'admin' : 'member',
      },
    });

    const memberName = createdMember.user?.name || 'A member';
    const nextSeq = teamConversation.lastSeq + 1;

    await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: teamConversation.id,
          senderId: targetUserId,
          content: ` ${memberName} joined the team`,
          seq: nextSeq,
        },
      }),
      prisma.conversation.update({
        where: { id: teamConversation.id },
        data: { lastSeq: nextSeq },
      }),
    ]);
  }


  try {
    await queueNotification({
      recipientId: targetUserId,
      type: 'TEAM_INVITE',
      title: 'Added to Team',
      body: `You were added to team "${team.name}"`,
      data: {
        organizationId,
        teamId,
        role: createdMember.role,
      },
    });
  } catch (err: any) {
    logger.warn('[TeamMember] Notification trigger failed', { error: err.message });
  }

  return createdMember;
};

export const removeTeamMember = async (
  organizationId: string,
  teamId: string,
  targetUserId: string
) => {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      organizationId,
    },
  });

  if (!team) {
    throw new ApiError(404, 'Team not found in this organization');
  }

  const membership = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: {
        teamId,
        userId: targetUserId,
      },
    },
  });

  if (!membership) {
    throw new ApiError(404, 'User is not a member of this team');
  }

  await prisma.teamMember.delete({
    where: {
      teamId_userId: {
        teamId,
        userId: targetUserId,
      },
    },
  });

  const teamConv = await prisma.conversation.findUnique({
    where: { teamId },
  });

  if (teamConv) {
    await prisma.conversationParticipant.deleteMany({
      where: {
        conversationId: teamConv.id,
        userId: targetUserId,
      },
    });

    const removedUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { name: true },
    });
    const nextSeq = teamConv.lastSeq + 1;

    await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: teamConv.id,
          senderId: targetUserId,
          content: ` ${removedUser?.name || 'A member'} left the team`,
          seq: nextSeq,
        },
      }),
      prisma.conversation.update({
        where: { id: teamConv.id },
        data: { lastSeq: nextSeq },
      }),
    ]);
  }



  return { message: 'Member removed from team successfully' };
};


export const getTeamConversation = async (teamId: string) => {
  return await prisma.conversation.findUnique({
    where: { teamId },
    include: {
      participants: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
      },
    },
  });
};

