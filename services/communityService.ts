import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { CommunityRole } from '@prisma/client';

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
  const community = await prisma.community.findUnique({
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

  const updatedCommunity = await prisma.community.update({
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
};

export const deleteCommunity = async (userId: string, communityId: string) => {
  const community = await prisma.community.findUnique({
    where: { id: communityId }
  });

  if (!community) {
    throw new ApiError(404, 'Community not found');
  }

  if (community.ownerId !== userId) {
    throw new ApiError(403, 'Only the community owner can delete the community');
  }

  await prisma.community.delete({
    where: { id: communityId }
  });

  return {
    success: true,
    message: 'Community deleted successfully'
  };
};

export const createInviteLink = async (userId: string, communityId: string, expiresInDays?: number) => {
  const community = await prisma.community.findUnique({
    where: { id: communityId }
  });

  if (!community) {
    throw new ApiError(404, 'Community not found');
  }

  const membership = await prisma.communityMember.findUnique({
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

  const invite = await prisma.communityInvite.create({
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
  const invite = await prisma.communityInvite.findUnique({
    where: { token }
  });

  if (!invite || invite.isRevoked) {
    throw new ApiError(404, 'Invitation link is invalid or has been revoked');
  }

  if (invite.expiresAt && invite.expiresAt < new Date()) {
    throw new ApiError(410, 'Invitation link has expired');
  }

  const existingMember = await prisma.communityMember.findUnique({
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

  const newMembership = await prisma.communityMember.create({
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
};

export const revokeInviteLink = async (userId: string, communityId: string, inviteId: string) => {
  const membership = await prisma.communityMember.findUnique({
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

  const invite = await prisma.communityInvite.findFirst({
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

  await prisma.communityInvite.update({
    where: { id: inviteId },
    data: { isRevoked: true }
  });

  return {
    success: true,
    message: 'Invitation link revoked successfully'
  };
};

