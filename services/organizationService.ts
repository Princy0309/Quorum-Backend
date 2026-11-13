import prisma from "../config/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { OrgRole } from '@prisma/client';
import crypto from 'crypto';
import type { CreateOrgInput, UpdateOrgInput, CreateInviteInput } from '../types/organization.js';
import { queueNotification } from '../queues/notificationQueue.js';
import logger from "../utils/logger.js";
import { addOrgInviteEmailToQueue } from '../queues/emailQueue.js';
import env from '../config/env.js';
import { uploadBufferToS3 } from './uploadService.js';
import { deleteS3Object } from '../config/s3.js';
import { createSystemOrgFeedPost } from './orgFeedService.js';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const createOrganization = async (userId: string, data: CreateOrgInput) => {
  const { name, description, logo, email, industry, teamSize } = data;

  if (!name || name.trim().length === 0) {
    throw new ApiError(400, 'Organization name is required');
  }

  const trimmedName = name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 100) {
    throw new ApiError(400, 'Organization name must be between 2 and 100 characters');
  }

  if (description && description.trim().length > 1000) {
    throw new ApiError(400, 'Organization description cannot exceed 1000 characters');
  }

  let baseSlug = slugify(name);
  if (!baseSlug) {
    baseSlug = 'org';
  }

  let slug = baseSlug;
  const existingOrg = await prisma.organization.findUnique({ where: { slug } });
  if (existingOrg) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    slug = `${baseSlug}-${randomSuffix}`;
  }
  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        logo: logo || null,
        email: email?.trim().toLowerCase() || null,
        industry: industry?.trim() || null,
        teamSize: teamSize?.trim() || null,
        ownerId: userId,
      },
    });

    const membership = await tx.organizationMember.create({
      data: {
        organizationId: org.id,
        userId,
        role: OrgRole.ORG_ADMIN,
      },
    });

    return {
      ...org,
      role: membership.role,
    };
  });

  return result;
};

export interface SearchOrganizationsOptions {
  query?: string;
  scope?: 'my' | 'all' | 'global';
  limit?: number;
}

export const searchOrganizations = async (
  userId: string,
  options: SearchOrganizationsOptions = {}
) => {
  const { query, scope = 'my', limit = 20 } = options;
  const trimmedQuery = query?.trim();
  const safeLimit = Math.min(Math.max(1, limit), 50);

  if (scope === 'all' || scope === 'global') {
    const whereClause: any = trimmedQuery
      ? {
        OR: [
          { name: { contains: trimmedQuery, mode: 'insensitive' } },
          { slug: { contains: trimmedQuery, mode: 'insensitive' } },
          { description: { contains: trimmedQuery, mode: 'insensitive' } },
        ],
      }
      : {};

    const organizations = await prisma.organization.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        logo: true,
        industry: true,
        teamSize: true,
        createdAt: true,
        _count: {
          select: { members: true },
        },
        members: {
          where: { userId },
          select: { role: true },
        },
      },
      take: safeLimit,
      orderBy: { name: 'asc' },
    });

    return organizations.map((org) => {
      const myMembership = org.members[0];
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        description: org.description,
        logo: org.logo,
        industry: org.industry,
        teamSize: org.teamSize,
        memberCount: org._count.members,
        createdAt: org.createdAt,
        isMember: !!myMembership,
        myRole: myMembership?.role || null,
        role: myMembership?.role || null,
      };
    });
  }

  const whereClause: any = {
    userId,
    ...(trimmedQuery && {
      organization: {
        OR: [
          { name: { contains: trimmedQuery, mode: 'insensitive' } },
          { slug: { contains: trimmedQuery, mode: 'insensitive' } },
          { description: { contains: trimmedQuery, mode: 'insensitive' } },
        ],
      },
    }),
  };

  const memberships = await prisma.organizationMember.findMany({
    where: whereClause,
    include: {
      organization: {
        include: {
          _count: {
            select: { members: true },
          },
        },
      },
    },
    take: safeLimit,
    orderBy: {
      joinedAt: 'desc',
    },
  });

  return memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    description: m.organization.description,
    logo: m.organization.logo,
    industry: m.organization.industry,
    teamSize: m.organization.teamSize,
    memberCount: m.organization._count?.members || 1,
    role: m.role,
    myRole: m.role,
    isMember: true,
    joinedAt: m.joinedAt,
  }));
};

export const getUserOrganizations = async (userId: string, query?: string) => {
  return await searchOrganizations(userId, { query, scope: 'my' });
};

export const getOrganizationById = async (orgId: string) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      owner: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
      _count: {
        select: {
          members: true,
        },
      },
    },
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }

  return {
    ...org,
    avatar: org.logo,
    profilePicture: org.logo,
    memberCount: org._count.members,
  };
};

export const updateOrganization = async (orgId: string, data: UpdateOrgInput) => {
  const existingOrg = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!existingOrg) {
    throw new ApiError(404, 'Organization not found');
  }

  if (data.name !== undefined) {
    const trimmedName = data.name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      throw new ApiError(400, 'Organization name must be between 2 and 100 characters');
    }
  }

  if (data.description !== undefined && data.description !== null) {
    if (data.description.trim().length > 1000) {
      throw new ApiError(400, 'Organization description cannot exceed 1000 characters');
    }
  }

  const resolvedLogo = data.logo !== undefined ? data.logo : (data.avatar !== undefined ? data.avatar : data.profilePicture);

  if (resolvedLogo !== undefined && existingOrg.logo && existingOrg.logo !== resolvedLogo) {
    await deleteS3Object(existingOrg.logo).catch(() => { });
  }

  const updatedOrg = await prisma.organization.update({
    where: { id: orgId },
    data: {
      name: data.name !== undefined ? data.name.trim() : undefined,
      description: data.description !== undefined ? data.description.trim() : undefined,
      logo: resolvedLogo !== undefined ? resolvedLogo : undefined,
      email: data.email !== undefined ? data.email?.trim().toLowerCase() || null : undefined,
      industry: data.industry !== undefined ? data.industry?.trim() || null : undefined,
      teamSize: data.teamSize !== undefined ? data.teamSize?.trim() || null : undefined,
    },
  });

  return {
    ...updatedOrg,
    avatar: updatedOrg.logo,
    profilePicture: updatedOrg.logo,
  };
};

export const updateOrganizationProfilePicture = async (
  userId: string,
  orgId: string,
  input: { logo?: string | null; avatar?: string | null; profilePicture?: string | null },
  file?: { buffer: Buffer; originalname: string; mimetype: string }
) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      members: {
        where: { userId }
      }
    }
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }

  const isOwner = org.ownerId === userId;
  const isAdmin = org.members.some((m) => m.role === OrgRole.ORG_ADMIN);
  if (!isOwner && !isAdmin) {
    throw new ApiError(403, 'Only organization admins can update the profile picture');
  }

  let finalLogo: string | null = input.logo !== undefined
    ? input.logo
    : (input.avatar !== undefined
      ? input.avatar
      : (input.profilePicture !== undefined ? input.profilePicture : org.logo));

  if (file && file.buffer && file.buffer.length > 0) {
    const uploadRes = await uploadBufferToS3(file.buffer, file.originalname, 'organizations', file.mimetype);
    finalLogo = uploadRes.publicUrl;
  }

  if (org.logo && org.logo !== finalLogo) {
    await deleteS3Object(org.logo).catch(() => { });
  }

  const updatedOrg = await prisma.organization.update({
    where: { id: orgId },
    data: { logo: finalLogo },
    include: {
      owner: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        }
      },
      _count: {
        select: {
          members: true,
        }
      }
    }
  });

  return {
    ...updatedOrg,
    avatar: updatedOrg.logo,
    profilePicture: updatedOrg.logo,
    memberCount: updatedOrg._count.members,
  };
};

export const deleteOrganizationProfilePicture = async (userId: string, orgId: string) => {
  return await updateOrganizationProfilePicture(userId, orgId, { logo: null });
};


export const deleteOrganization = async (orgId: string, userId: string) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, ownerId: true },
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }

  await prisma.organization.delete({
    where: { id: orgId },
  });

  return { message: `Organization '${org.name}' deleted successfully` };
};

export const getOrganizationMembers = async (
  orgId: string,
  options?: { search?: string; role?: OrgRole }
) => {
   const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, ownerId: true },
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }

  const whereClause: any = {
    organizationId: orgId,
  };

  if (options?.role && Object.values(OrgRole).includes(options.role)) {
    whereClause.role = options.role;
  }

  if (options?.search && options.search.trim().length > 0) {
    const term = options.search.trim();
    whereClause.user = {
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
      ],
    };
  }

  const members = await prisma.organizationMember.findMany({
    where: whereClause,
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
    orderBy: {
      joinedAt: 'asc',
    },
  });

  return members.map((m) => {
    const isOwner = org.ownerId === m.userId;
    return {
      id: m.id,
      userId: m.userId,
      role: isOwner ? 'OWNER' : m.role,
      isOwner,
      joinedAt: m.joinedAt,
      user: m.user,
    };
  });
};

export const updateMemberRole = async (
  orgId: string,
  currentUserId: string,
  targetUserId: string,
  newRole: OrgRole
) => {
  if (!Object.values(OrgRole).includes(newRole)) {
    throw new ApiError(400, `Invalid role. Allowed roles are: ${Object.values(OrgRole).join(', ')}`);
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, ownerId: true },
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }

  if (org.ownerId === targetUserId) {
    throw new ApiError(400, 'Cannot change the role of the organization owner');
  }

  if (currentUserId === targetUserId && newRole !== OrgRole.ORG_ADMIN) {
    const adminCount = await prisma.organizationMember.count({
      where: { organizationId: orgId, role: OrgRole.ORG_ADMIN },
    });
    if (adminCount <= 1) {
      throw new ApiError(400, 'Cannot demote yourself: organization must have at least one admin');
    }
  }

  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: orgId,
        userId: targetUserId,
      },
    },
  });

  if (!membership) {
    throw new ApiError(404, 'Member not found in this organization');
  }

  const updatedMembership = await prisma.organizationMember.update({
    where: { id: membership.id },
    data: { role: newRole },
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

  const roleRank: Record<OrgRole, number> = {
    [OrgRole.MEMBER]: 1,
    [OrgRole.TEAM_HEAD]: 2,
    [OrgRole.ORG_ADMIN]: 3,
  };

  if (roleRank[newRole] > roleRank[membership.role]) {
    const roleLabel = newRole === OrgRole.ORG_ADMIN ? 'Organization Admin' : 'Team Head';
    void createSystemOrgFeedPost({
      organizationId: orgId,
      category: 'PROMOTION',
      title: 'Promotion Announcement!',
      content: `Congratulations to ${updatedMembership.user.name} on being promoted to ${roleLabel}!`,
      actorId: currentUserId,
      targetUserId,
    });
  }

  return {
    id: updatedMembership.id,
    userId: updatedMembership.userId,
    role: updatedMembership.role,
    joinedAt: updatedMembership.joinedAt,
    user: updatedMembership.user,
  };
};

export const removeMember = async (
  orgId: string,
  currentUserId: string,
  targetUserId: string
) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, ownerId: true },
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }

  if (org.ownerId === targetUserId) {
    throw new ApiError(400, 'Cannot remove the organization owner');
  }

  if (currentUserId === targetUserId) {
    throw new ApiError(400, 'Cannot remove yourself. Use the leave organization option instead');
  }

  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: orgId,
        userId: targetUserId,
      },
    },
  });

  if (!membership) {
    throw new ApiError(404, 'Member not found in this organization');
  }


  await prisma.organizationMember.delete({
    where: { id: membership.id },
  });

  return { message: 'Member removed successfully' };
};

export const leaveOrganization = async (orgId: string, userId: string) => {

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, ownerId: true },
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }


  if (org.ownerId === userId) {
    throw new ApiError(
      400,
      'The organization owner cannot leave. Transfer ownership or delete the organization instead'
    );
  }


  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: orgId,
        userId,
      },
    },
  });

  if (!membership) {
    throw new ApiError(404, 'You are not a member of this organization');
  }


  await prisma.organizationMember.delete({
    where: { id: membership.id },
  });

  return { message: 'Left organization successfully' };
};

export const transferOrganizationOwnership = async (
  orgId: string,
  callerUserId: string,
  newOwnerId: string,
  leaveOrganization: boolean = false
) => {
  if (callerUserId === newOwnerId) {
    throw new ApiError(400, 'You cannot transfer ownership to yourself');
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, ownerId: true },
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }

  if (org.ownerId !== callerUserId) {
    throw new ApiError(403, 'Only the organization owner can transfer ownership');
  }

  const newOwnerMember = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: orgId,
        userId: newOwnerId,
      },
    },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  if (!newOwnerMember) {
    throw new ApiError(400, 'Successor must be an active member of this organization');
  }

  await prisma.$transaction(async (tx) => {
    // 1. Update Primary Owner on Organization
    await tx.organization.update({
      where: { id: orgId },
      data: { ownerId: newOwnerId },
    });

    // 2. Ensure new owner has ORG_ADMIN role
    await tx.organizationMember.update({
      where: { id: newOwnerMember.id },
      data: { role: OrgRole.ORG_ADMIN },
    });

    // 3. If previous owner requested to leave the organization immediately
    if (leaveOrganization) {
      await tx.organizationMember.delete({
        where: {
          organizationId_userId: {
            organizationId: orgId,
            userId: callerUserId,
          },
        },
      });

      // Remove from all teams in this organization
      const orgTeams = await tx.team.findMany({
        where: { organizationId: orgId },
        select: { id: true },
      });
      const teamIds = orgTeams.map((t) => t.id);

      if (teamIds.length > 0) {
        await tx.teamMember.deleteMany({
          where: { teamId: { in: teamIds }, userId: callerUserId },
        });

        const teamConvs = await tx.conversation.findMany({
          where: { teamId: { in: teamIds } },
          select: { id: true },
        });
        const convIds = teamConvs.map((c) => c.id);

        if (convIds.length > 0) {
          await tx.conversationParticipant.deleteMany({
            where: { conversationId: { in: convIds }, userId: callerUserId },
          });
        }
      }
    }
  });

  // 4. Send push notification to new owner
  try {
    await queueNotification({
      recipientId: newOwnerId,
      actorId: callerUserId,
      type: 'ORG_INVITE',
      title: 'Organization Ownership Transferred',
      body: `You are now the Primary Owner of organization "${org.name}"`,
      data: {
        organizationId: orgId,
        role: OrgRole.ORG_ADMIN,
      },
    });
  } catch (err: any) {
    logger.warn('[OrgOwnershipTransfer] Notification failed', { error: err.message });
  }

  return {
    message: leaveOrganization
      ? `Ownership transferred to ${newOwnerMember.user.name}. You have left the organization.`
      : `Ownership transferred to ${newOwnerMember.user.name}. You are now an Organization Admin.`,
  };
};


export const createOrganizationInvite = async (
  orgId: string,
  inviterId: string,
  data: CreateInviteInput
) => {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }

  const targetRole = data.role || OrgRole.MEMBER;
  if (!Object.values(OrgRole).includes(targetRole)) {
    throw new ApiError(400, `Invalid role. Allowed roles: ${Object.values(OrgRole).join(', ')}`);
  }

  // Verify team if teamId is provided
  let targetTeam: { id: string; name: string } | null = null;
  const targetTeamRole = data.teamRole ? data.teamRole.toUpperCase() : (data.teamId ? 'MEMBER' : null);

  if (data.teamId) {
    const team = await prisma.team.findFirst({
      where: { id: data.teamId, organizationId: orgId },
      select: { id: true, name: true },
    });
    if (!team) {
      throw new ApiError(404, 'Team not found in this organization');
    }
    targetTeam = team;

    // Permissions: Only ORG_ADMIN or the LEAD of this team can invite
    const inviterOrgMember = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: inviterId } },
    });
    if (inviterOrgMember?.role !== OrgRole.ORG_ADMIN) {
      const inviterTeamMember = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: data.teamId, userId: inviterId } },
      });
      if (inviterTeamMember?.role !== 'LEAD') {
        throw new ApiError(403, 'Only org admins or the team lead of this team can invite members');
      }
    }
  }

  const normalizedEmail = data.email?.trim().toLowerCase();

  if (normalizedEmail) {
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existingUser) {
      const existingMember = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: orgId,
            userId: existingUser.id,
          },
        },
      });

      if (existingMember) {
        if (data.teamId) {
          // Allow if they are not yet in this specific team
          const existingTeamMember = await prisma.teamMember.findUnique({
            where: {
              teamId_userId: {
                teamId: data.teamId,
                userId: existingUser.id,
              },
            },
          });

          if (existingTeamMember) {
            throw new ApiError(400, 'This user is already a member of this team');
          }
        } else {
          throw new ApiError(400, 'This user is already a member of this organization');
        }
      }
    }

    const pendingInvite = await prisma.organizationInvite.findFirst({
      where: {
        organizationId: orgId,
        email: normalizedEmail,
        teamId: data.teamId || null,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (pendingInvite) {
      throw new ApiError(400, 'An active invite has already been sent to this email for this team');
    }
  }

  const token = crypto.randomBytes(24).toString('hex');
  const days = data.expiresInDays && data.expiresInDays > 0 ? Math.min(data.expiresInDays, 30) : 7;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const invite = await prisma.organizationInvite.create({
    data: {
      organizationId: orgId,
      inviterId,
      email: normalizedEmail || null,
      role: targetTeamRole === 'LEAD' ? OrgRole.TEAM_HEAD : targetRole,
      teamId: data.teamId || null,
      teamRole: targetTeamRole,
      token,
      expiresAt,
      maxUses: data.maxUses && data.maxUses > 0 ? data.maxUses : 1,
    },
    include: {
      organization: {
        select: { id: true, name: true, slug: true, logo: true },
      },
      inviter: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      team: {
        select: { id: true, name: true },
      },
    },
  });

  if (normalizedEmail) {
    const inviteLink = `${env.CLIENT_URL}/join/${invite.token}`;

    try {
      await addOrgInviteEmailToQueue({
        email: normalizedEmail,
        inviterName: invite.inviter.name,
        orgName: invite.organization.name,
        role: invite.role,
        inviteLink,
        expiresInDays: days,
        teamName: targetTeam?.name,
        teamRole: targetTeamRole || undefined,
      });
    } catch (err: any) {
      logger.warn('[OrganizationInvite] Email queue failed', { error: err.message });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existingUser) {
      try {
        const notifBody = targetTeam
          ? (targetTeamRole === 'LEAD'
            ? `${invite.inviter.name} invited you to lead ${targetTeam.name} at ${invite.organization.name}`
            : `${invite.inviter.name} invited you to join ${targetTeam.name} at ${invite.organization.name}`)
          : `${invite.inviter.name} invited you to join ${invite.organization.name}`;

        await queueNotification({
          recipientId: existingUser.id,
          actorId: inviterId,
          type: 'ORG_INVITE',
          title: 'Organization Invitation',
          body: notifBody,
          data: {
            organizationId: orgId,
            token: invite.token,
            role: invite.role,
            teamId: invite.teamId,
            teamRole: invite.teamRole,
          },
        });
      } catch (err: any) {
        logger.warn('[OrganizationInvite] Notification trigger failed', { error: err.message });
      }
    }
  }

  return invite;
};


export const getInvitePreview = async (token: string) => {
  const invite = await prisma.organizationInvite.findUnique({
    where: { token },
    include: {
      organization: {
        select: { id: true, name: true, slug: true, logo: true, description: true },
      },
      inviter: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      team: {
        select: { id: true, name: true },
      },
    },
  });

  if (!invite) {
    throw new ApiError(404, 'Invalid or non-existent invite link');
  }

  if (invite.isRevoked) {
    throw new ApiError(400, 'This invite link has been revoked by an administrator');
  }

  if (invite.expiresAt < new Date()) {
    throw new ApiError(400, 'This invite link has expired');
  }

  if (invite.usedCount >= invite.maxUses) {
    throw new ApiError(400, 'This invite link has reached its maximum usage limit');
  }

  return {
    id: invite.id,
    organization: invite.organization,
    inviter: invite.inviter,
    role: invite.role,
    teamId: invite.teamId,
    teamName: invite.team?.name || null,
    teamRole: invite.teamRole,
    email: invite.email,
    expiresAt: invite.expiresAt,
  };
};


export const acceptOrganizationInvite = async (
  token: string,
  userId: string,
  userEmail: string
) => {
  const invite = await prisma.organizationInvite.findUnique({
    where: { token },
  });

  if (!invite) {
    throw new ApiError(404, 'Invalid or non-existent invite link');
  }

  if (invite.isRevoked) {
    throw new ApiError(400, 'This invite link has been revoked');
  }

  if (invite.expiresAt < new Date()) {
    throw new ApiError(400, 'This invite link has expired');
  }

  if (invite.usedCount >= invite.maxUses) {
    throw new ApiError(400, 'This invite link has reached its maximum usage limit');
  }

  if (invite.email && invite.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new ApiError(
      403,
      `This invite was sent specifically to ${invite.email}. Please sign in with that email address.`
    );
  }

  const existingMember = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: invite.organizationId,
        userId,
      },
    },
  });

  // If already a member of the organization:
  if (existingMember) {
    // If this invite is for a specific team, allow them to join this team
    if (invite.teamId) {
      const existingTeamMember = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: invite.teamId,
            userId,
          },
        },
      });

      if (existingTeamMember) {
        throw new ApiError(400, 'You are already a member of this team');
      }

      const teamRole = invite.teamRole || 'MEMBER';

      await prisma.$transaction(async (tx) => {
        await tx.teamMember.create({
          data: {
            teamId: invite.teamId!,
            userId,
            role: teamRole,
          },
        });

        if (teamRole === 'LEAD' && existingMember.role === OrgRole.MEMBER) {
          await tx.organizationMember.update({
            where: { id: existingMember.id },
            data: { role: OrgRole.TEAM_HEAD },
          });
        }

        await tx.organizationInvite.update({
          where: { id: invite.id },
          data: { usedCount: { increment: 1 } },
        });

        // Add to team chat conversation if it exists
        const teamConv = await tx.conversation.findUnique({
          where: { teamId: invite.teamId! },
        });

        if (teamConv) {
          await tx.conversationParticipant.upsert({
            where: {
              conversationId_userId: {
                conversationId: teamConv.id,
                userId,
              },
            },
            create: {
              conversationId: teamConv.id,
              userId,
              role: teamRole === 'LEAD' ? 'admin' : 'member',
            },
            update: {
              role: teamRole === 'LEAD' ? 'admin' : 'member',
            },
          });

          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { name: true },
          });

          const memberName = user?.name || 'A member';
          const nextSeq = teamConv.lastSeq + 1;

          await tx.message.create({
            data: {
              conversationId: teamConv.id,
              senderId: userId,
              content: ` ${memberName} joined the team`,
              seq: nextSeq,
            },
          });

          await tx.conversation.update({
            where: { id: teamConv.id },
            data: { lastSeq: nextSeq },
          });
        }
      });

      return existingMember;
    }

    throw new ApiError(400, 'You are already a member of this organization');
  }

  // New member joining organization (and team if invite has teamId)
  const result = await prisma.$transaction(async (tx) => {
    const member = await tx.organizationMember.create({
      data: {
        organizationId: invite.organizationId,
        userId,
        role: invite.role,
      },
      include: {
        organization: true,
      },
    });

    await tx.organizationInvite.update({
      where: { id: invite.id },
      data: {
        usedCount: { increment: 1 },
      },
    });

    // If invite is linked to a team, join team + conversation
    if (invite.teamId) {
      const team = await tx.team.findUnique({
        where: { id: invite.teamId },
      });

      if (team && team.organizationId === invite.organizationId) {
        const teamRole = invite.teamRole || 'MEMBER';

        await tx.teamMember.create({
          data: {
            teamId: invite.teamId,
            userId,
            role: teamRole,
          },
        });

        const teamConv = await tx.conversation.findUnique({
          where: { teamId: invite.teamId },
        });

        if (teamConv) {
          await tx.conversationParticipant.upsert({
            where: {
              conversationId_userId: {
                conversationId: teamConv.id,
                userId,
              },
            },
            create: {
              conversationId: teamConv.id,
              userId,
              role: teamRole === 'LEAD' ? 'admin' : 'member',
            },
            update: {
              role: teamRole === 'LEAD' ? 'admin' : 'member',
            },
          });

          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { name: true },
          });

          const memberName = user?.name || 'A member';
          const nextSeq = teamConv.lastSeq + 1;

          await tx.message.create({
            data: {
              conversationId: teamConv.id,
              senderId: userId,
              content: ` ${memberName} joined the team`,
              seq: nextSeq,
            },
          });

          await tx.conversation.update({
            where: { id: teamConv.id },
            data: { lastSeq: nextSeq },
          });
        }
      }
    }

    return member;
  });

  void (async () => {
    try {
      const [newUser, joinedTeam] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
        invite.teamId
          ? prisma.team.findUnique({ where: { id: invite.teamId }, select: { name: true } })
          : Promise.resolve(null),
      ]);
      const memberName = newUser?.name || 'A new teammate';
      const teamSuffix = joinedTeam ? ` (${joinedTeam.name})` : '';
      await createSystemOrgFeedPost({
        organizationId: invite.organizationId,
        category: 'WELCOME',
        title: `Welcome ${memberName}!`,
        content: `Everyone please join us in welcoming ${memberName}${teamSuffix} to ${result.organization.name}!`,
        actorId: invite.inviterId,
        targetUserId: userId,
        targetTeamId: joinedTeam ? invite.teamId : null,
      });
    } catch (err: any) {
      logger.warn(`[OrganizationInvite] Failed to post welcome feed item: ${err?.message}`);
    }
  })();

  return result;
};

export const getOrganizationInvites = async (orgId: string) => {
  const invites = await prisma.organizationInvite.findMany({
    where: {
      organizationId: orgId,
      isRevoked: false,
    },
    include: {
      inviter: {
        select: { id: true, name: true, email: true },
      },
      team: {
        select: { id: true, name: true },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return invites;
};


export const revokeOrganizationInvite = async (orgId: string, inviteId: string) => {
  const invite = await prisma.organizationInvite.findFirst({
    where: {
      id: inviteId,
      organizationId: orgId,
    },
  });

  if (!invite) {
    throw new ApiError(404, 'Invite not found');
  }

  await prisma.organizationInvite.update({
    where: { id: invite.id },
    data: { isRevoked: true },
  });

  return { message: 'Invite revoked successfully' };
};





