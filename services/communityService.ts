import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';

export const CommunityRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER'
} as const;
export type CommunityRole = (typeof CommunityRole)[keyof typeof CommunityRole];

export interface CreateCommunityInput {
  name: string;
  description?: string;
}

export interface UpdateCommunityInput {
  name?: string;
  description?: string;
}

export const createCommunity = async (userId: string, data: CreateCommunityInput) => {
  return await prisma.$transaction(async (tx) => {
    const community = await tx.community.create({
      data: {
        name: data.name.trim(),
        description: data.description?.trim() || null,
        ownerId: userId,
        members: {
          create: {
            userId,
            role: CommunityRole.OWNER
          }
        }
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        },
        _count: {
          select: {
            members: true
          }
        }
      }
    });

    return {
      id: community.id,
      name: community.name,
      description: community.description,
      ownerId: community.ownerId,
      owner: community.owner,
      role: CommunityRole.OWNER,
      memberCount: community._count.members,
      createdAt: community.createdAt,
      updatedAt: community.updatedAt
    };
  });
};

export const getUserCommunities = async (userId: string) => {
  const memberships = await prisma.communityMember.findMany({
    where: { userId },
    include: {
      community: {
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              avatar: true
            }
          },
          _count: {
            select: {
              members: true
            }
          }
        }
      }
    },
    orderBy: {
      joinedAt: 'desc'
    }
  });

  return memberships.map((membership) => ({
    id: membership.community.id,
    name: membership.community.name,
    description: membership.community.description,
    ownerId: membership.community.ownerId,
    owner: membership.community.owner,
    role: membership.role,
    memberCount: membership.community._count.members,
    joinedAt: membership.joinedAt,
    createdAt: membership.community.createdAt,
    updatedAt: membership.community.updatedAt
  }));
};

export const getCommunityDetails = async (userId: string, communityId: string) => {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    include: {
      owner: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      },
      members: {
        where: { userId },
        select: {
          role: true,
          joinedAt: true
        }
      },
      _count: {
        select: {
          members: true
        }
      }
    }
  });

  if (!community) {
    throw new ApiError(404, 'Community not found');
  }

  const membership = community.members[0];
  if (!membership) {
    throw new ApiError(403, 'Access denied. You are not a member of this community');
  }

  return {
    id: community.id,
    name: community.name,
    description: community.description,
    ownerId: community.ownerId,
    owner: community.owner,
    role: membership.role,
    memberCount: community._count.members,
    joinedAt: membership.joinedAt,
    createdAt: community.createdAt,
    updatedAt: community.updatedAt
  };
};

export const updateCommunity = async (userId: string, communityId: string, data: UpdateCommunityInput) => {
  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${communityId} FOR UPDATE`;

    const community = await tx.community.findUnique({
      where: { id: communityId }
    });

    if (!community) {
      throw new ApiError(404, 'Community not found');
    }

    if (community.ownerId !== userId) {
      throw new ApiError(403, 'Only the community owner can update community settings');
    }

    const updateData: { name?: string; description?: string | null } = {};
    if (data.name !== undefined) {
      updateData.name = data.name.trim();
    }
    if (data.description !== undefined) {
      updateData.description = data.description?.trim() || null;
    }

    const updatedCommunity = await tx.community.update({
      where: { id: communityId },
      data: updateData,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        },
        _count: {
          select: {
            members: true
          }
        }
      }
    });

    return {
      id: updatedCommunity.id,
      name: updatedCommunity.name,
      description: updatedCommunity.description,
      ownerId: updatedCommunity.ownerId,
      owner: updatedCommunity.owner,
      memberCount: updatedCommunity._count.members,
      createdAt: updatedCommunity.createdAt,
      updatedAt: updatedCommunity.updatedAt
    };
  });
};

export const deleteCommunity = async (userId: string, communityId: string) => {
  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${communityId} FOR UPDATE`;

    const community = await tx.community.findUnique({
      where: { id: communityId }
    });

    if (!community) {
      throw new ApiError(404, 'Community not found');
    }

    if (community.ownerId !== userId) {
      throw new ApiError(403, 'Only the community owner can delete the community');
    }

    await tx.community.delete({
      where: { id: communityId }
    });

    return {
      success: true,
      message: 'Community deleted successfully'
    };
  });
};

export const createInviteLink = async (userId: string, communityId: string, expiresInDays?: number) => {
  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${communityId} FOR UPDATE`;

    const community = await tx.community.findUnique({
      where: { id: communityId }
    });

    if (!community) {
      throw new ApiError(404, 'Community not found');
    }

    const membership = await tx.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId,
          userId
        }
      }
    });

    if (!membership || (membership.role !== CommunityRole.OWNER && membership.role !== CommunityRole.ADMIN)) {
      throw new ApiError(403, 'Only community owners and admins can generate invitation links');
    }

    const token = crypto.randomBytes(16).toString('hex');
    const days = expiresInDays && expiresInDays > 0 ? expiresInDays : 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    const invite = await tx.communityInvite.create({
      data: {
        communityId,
        inviterId: userId,
        token,
        expiresAt
      },
      include: {
        community: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    return {
      id: invite.id,
      communityId: invite.communityId,
      communityName: invite.community.name,
      token: invite.token,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt
    };
  });
};

export const validateInviteToken = async (token: string) => {
  const invite = await prisma.communityInvite.findUnique({
    where: { token },
    include: {
      community: {
        select: {
          id: true,
          name: true,
          description: true,
          _count: {
            select: {
              members: true
            }
          }
        }
      },
      inviter: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  });

  if (!invite || invite.isRevoked) {
    throw new ApiError(404, 'Invitation link is invalid or has been revoked');
  }

  if (invite.expiresAt && invite.expiresAt < new Date()) {
    throw new ApiError(410, 'Invitation link has expired');
  }

  return {
    valid: true,
    community: {
      id: invite.community.id,
      name: invite.community.name,
      description: invite.community.description,
      memberCount: invite.community._count.members
    },
    inviter: invite.inviter,
    expiresAt: invite.expiresAt
  };
};

export const joinCommunityViaInvite = async (userId: string, token: string) => {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "CommunityInvite" WHERE token = ${token} FOR UPDATE`;

      const invite = await tx.communityInvite.findUnique({
        where: { token }
      });

      if (!invite || invite.isRevoked) {
        throw new ApiError(404, 'Invitation link is invalid or has been revoked');
      }

      if (invite.expiresAt && invite.expiresAt < new Date()) {
        throw new ApiError(410, 'Invitation link has expired');
      }

      const existingMember = await tx.communityMember.findUnique({
        where: {
          communityId_userId: {
            communityId: invite.communityId,
            userId
          }
        }
      });

      if (existingMember) {
        throw new ApiError(400, 'You are already a member of this community');
      }

      const newMembership = await tx.communityMember.create({
        data: {
          communityId: invite.communityId,
          userId,
          role: CommunityRole.MEMBER
        },
        include: {
          community: {
            include: {
              owner: {
                select: {
                  id: true,
                  name: true,
                  avatar: true
                }
              },
              _count: {
                select: {
                  members: true
                }
              }
            }
          }
        }
      });

      return {
        communityId: newMembership.communityId,
        name: newMembership.community.name,
        description: newMembership.community.description,
        role: newMembership.role,
        memberCount: newMembership.community._count.members,
        joinedAt: newMembership.joinedAt
      };
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw new ApiError(400, 'You are already a member of this community');
    }
    throw err;
  }
};

export const revokeInviteLink = async (userId: string, communityId: string, inviteId: string) => {
  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${communityId} FOR UPDATE`;

    const membership = await tx.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId,
          userId
        }
      }
    });

    if (!membership || (membership.role !== CommunityRole.OWNER && membership.role !== CommunityRole.ADMIN)) {
      throw new ApiError(403, 'Only community owners and admins can revoke invitation links');
    }

    await tx.$queryRaw`SELECT id FROM "CommunityInvite" WHERE id = ${inviteId} FOR UPDATE`;

    const invite = await tx.communityInvite.findFirst({
      where: {
        id: inviteId,
        communityId
      }
    });

    if (!invite) {
      throw new ApiError(404, 'Invitation link not found');
    }

    if (invite.isRevoked) {
      return {
        success: true,
        message: 'Invitation link is already revoked'
      };
    }

    await tx.communityInvite.update({
      where: { id: inviteId },
      data: { isRevoked: true }
    });

    return {
      success: true,
      message: 'Invitation link revoked successfully'
    };
  });
};

export const searchUsersToInvite = async (
  userId: string,
  communityId: string,
  query: string,
  cursor?: string,
  limit: number = 20
) => {
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId,
        userId
      }
    }
  });

  if (!membership || (membership.role !== CommunityRole.OWNER && membership.role !== CommunityRole.ADMIN)) {
    throw new ApiError(403, 'Only community owners and admins can search users to invite');
  }

  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  const take = Math.min(Math.max(limit, 1), 50);

  const existingMembers = await prisma.communityMember.findMany({
    where: { communityId },
    select: { userId: true }
  });
  const excludedUserIds = existingMembers.map((m) => m.userId);

  const whereClause: any = {
    id: { notIn: excludedUserIds }
  };

  if (cleanQuery) {
    whereClause.name = { contains: cleanQuery, mode: 'insensitive' };
  }

  const users = await prisma.user.findMany({
    where: whereClause,
    take: take + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { id: 'asc' },
    select: {
      id: true,
      name: true,
      avatar: true
    }
  });

  const hasNextPage = users.length > take;
  const pagedUsers = hasNextPage ? users.slice(0, take) : users;
  const nextCursor = hasNextPage && pagedUsers.length > 0 ? pagedUsers[pagedUsers.length - 1].id : null;

  return {
    users: pagedUsers,
    nextCursor,
    hasNextPage
  };
};

export const listCommunityMembers = async (
  userId: string,
  communityId: string,
  cursor?: string,
  limit: number = 20
) => {
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId,
        userId
      }
    }
  });

  if (!membership) {
    throw new ApiError(403, 'Access denied. You are not a member of this community');
  }

  const take = Math.min(Math.max(limit, 1), 50);

  if (cursor) {
    const cursorMember = await prisma.communityMember.findFirst({
      where: {
        id: cursor,
        communityId
      }
    });

    if (!cursorMember) {
      throw new ApiError(400, 'Invalid pagination cursor for this community');
    }
  }

  const members = await prisma.communityMember.findMany({
    where: { communityId },
    take: take + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [
      { joinedAt: 'asc' },
      { id: 'asc' }
    ],
    select: {
      id: true,
      role: true,
      joinedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      }
    }
  });

  const hasNextPage = members.length > take;
  const pagedMembers = hasNextPage ? members.slice(0, take) : members;
  const nextCursor = hasNextPage && pagedMembers.length > 0 ? pagedMembers[pagedMembers.length - 1].id : null;

  return {
    members: pagedMembers,
    nextCursor,
    hasNextPage
  };
};

export const leaveCommunity = async (userId: string, communityId: string) => {
  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${communityId} FOR UPDATE`;

    const community = await tx.community.findUnique({
      where: { id: communityId }
    });

    if (!community) {
      throw new ApiError(404, 'Community not found');
    }

    const membership = await tx.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId,
          userId
        }
      }
    });

    if (!membership) {
      throw new ApiError(400, 'You are not a member of this community');
    }

    if (membership.role === CommunityRole.OWNER || community.ownerId === userId) {
      const otherOwners = await tx.communityMember.findMany({
        where: {
          communityId,
          role: CommunityRole.OWNER,
          userId: { not: userId }
        }
      });

      if (otherOwners.length === 0) {
        throw new ApiError(400, 'Cannot leave the community as the sole owner. Please transfer ownership before leaving or delete the community');
      }

      if (community.ownerId === userId) {
        await tx.community.update({
          where: { id: communityId },
          data: { ownerId: otherOwners[0].userId }
        });
      }
    }

    await tx.communityMember.delete({
      where: {
        communityId_userId: {
          communityId,
          userId
        }
      }
    });

    return { message: 'Successfully left the community' };
  });
};

export const removeCommunityMember = async (
  actorId: string,
  communityId: string,
  targetUserId: string
) => {
  if (actorId === targetUserId) {
    throw new ApiError(400, 'Cannot remove yourself via this endpoint. Please use the leave endpoint instead');
  }

  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${communityId} FOR UPDATE`;

    const community = await tx.community.findUnique({
      where: { id: communityId }
    });

    if (!community) {
      throw new ApiError(404, 'Community not found');
    }

    const actorMembership = await tx.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId,
          userId: actorId
        }
      }
    });

    if (!actorMembership) {
      throw new ApiError(403, 'Access denied. You are not a member of this community');
    }

    if (actorMembership.role === CommunityRole.MEMBER) {
      throw new ApiError(403, 'Access denied. Only owners and admins can remove members');
    }

    const targetMembership = await tx.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId,
          userId: targetUserId
        }
      }
    });

    if (!targetMembership) {
      throw new ApiError(404, 'Member not found in this community');
    }

    if (actorMembership.role === CommunityRole.ADMIN) {
      if (targetMembership.role === CommunityRole.OWNER || targetMembership.role === CommunityRole.ADMIN) {
        throw new ApiError(403, 'Admins cannot remove other admins or owners');
      }
    }

    if (targetMembership.role === CommunityRole.OWNER || community.ownerId === targetUserId) {
      const otherOwners = await tx.communityMember.findMany({
        where: {
          communityId,
          role: CommunityRole.OWNER,
          userId: { not: targetUserId }
        }
      });

      if (otherOwners.length === 0) {
        throw new ApiError(400, 'Cannot remove the sole owner of the community');
      }

      if (community.ownerId === targetUserId) {
        await tx.community.update({
          where: { id: communityId },
          data: { ownerId: otherOwners[0].userId }
        });
      }
    }

    await tx.communityMember.delete({
      where: {
        communityId_userId: {
          communityId,
          userId: targetUserId
        }
      }
    });

    return { message: 'Member removed successfully' };
  });
};

export const changeMemberRole = async (
  actorId: string,
  communityId: string,
  targetUserId: string,
  newRole: 'ADMIN' | 'MEMBER'
) => {
  if (actorId === targetUserId) {
    throw new ApiError(400, 'Cannot change your own role');
  }

  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${communityId} FOR UPDATE`;

    const community = await tx.community.findUnique({
      where: { id: communityId }
    });

    if (!community) {
      throw new ApiError(404, 'Community not found');
    }

    if (community.ownerId !== actorId) {
      throw new ApiError(403, 'Only the community owner can change member roles');
    }

    const targetMembership = await tx.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId,
          userId: targetUserId
        }
      }
    });

    if (!targetMembership) {
      throw new ApiError(404, 'Member not found in this community');
    }

    const updated = await tx.communityMember.update({
      where: {
        communityId_userId: {
          communityId,
          userId: targetUserId
        }
      },
      data: {
        role: newRole
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true
          }
        }
      }
    });

    return {
      id: updated.id,
      communityId: updated.communityId,
      userId: updated.userId,
      role: updated.role,
      user: updated.user,
      joinedAt: updated.joinedAt
    };
  });
};

export const transferCommunityOwnership = async (
  actorId: string,
  communityId: string,
  newOwnerId: string
) => {
  if (actorId === newOwnerId) {
    throw new ApiError(400, 'Cannot transfer ownership to yourself');
  }

  return await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${communityId} FOR UPDATE`;

    const community = await tx.community.findUnique({
      where: { id: communityId }
    });

    if (!community) {
      throw new ApiError(404, 'Community not found');
    }

    if (community.ownerId !== actorId) {
      throw new ApiError(403, 'Only the community owner can transfer ownership');
    }

    const targetMembership = await tx.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId,
          userId: newOwnerId
        }
      }
    });

    if (!targetMembership) {
      throw new ApiError(404, 'Target user is not a member of this community');
    }

    await tx.community.update({
      where: { id: communityId },
      data: { ownerId: newOwnerId }
    });

    await tx.communityMember.update({
      where: {
        communityId_userId: {
          communityId,
          userId: actorId
        }
      },
      data: { role: CommunityRole.ADMIN }
    });

    await tx.communityMember.update({
      where: {
        communityId_userId: {
          communityId,
          userId: newOwnerId
        }
      },
      data: { role: CommunityRole.OWNER }
    });

    return {
      message: 'Community ownership transferred successfully',
      communityId,
      newOwnerId,
      previousOwnerId: actorId
    };
  });
};

export const searchCommunities = async (
  userId: string,
  query: string,
  cursor?: string,
  limit: number = 20
) => {
  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  const take = Math.min(Math.max(limit, 1), 50);

  const whereClause: any = {};
  if (cleanQuery) {
    whereClause.OR = [
      { name: { contains: cleanQuery, mode: 'insensitive' } },
      { description: { contains: cleanQuery, mode: 'insensitive' } }
    ];
  }

  const communities = await prisma.community.findMany({
    where: whereClause,
    take: take + 1,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      owner: {
        select: {
          id: true,
          name: true,
          avatar: true
        }
      },
      members: {
        where: { userId },
        select: {
          role: true,
          joinedAt: true
        }
      },
      _count: {
        select: {
          members: true,
          posts: true
        }
      }
    }
  });

  const hasNextPage = communities.length > take;
  const pagedCommunities = hasNextPage ? communities.slice(0, take) : communities;
  const nextCursor = hasNextPage && pagedCommunities.length > 0 ? pagedCommunities[pagedCommunities.length - 1].id : null;

  return {
    communities: pagedCommunities.map((c) => {
      const userMembership = c.members && c.members.length > 0 ? c.members[0] : null;
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        ownerId: c.ownerId,
        owner: c.owner,
        memberCount: c._count.members,
        postCount: c._count.posts,
        isMember: !!userMembership,
        role: userMembership ? userMembership.role : null,
        joinedAt: userMembership ? userMembership.joinedAt : null,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      };
    }),
    nextCursor,
    hasNextPage
  };
};

