import prisma from "../config/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { OrgRole } from '@prisma/client';
import crypto from 'crypto';
import type { CreateOrgInput, UpdateOrgInput, CreateInviteInput } from '../types/organization.js';
import {queueNotification} from '../queues/notificationQueue.js';
import logger from "../utils/logger.js";
import { addOrgInviteEmailToQueue } from '../queues/emailQueue.js';
import env from '../config/env.js';



function slugify(text: string): string{
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

export const getUserOrganizations = async (userId: string) => {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    include: {
      organization: true,
    },
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
    role: m.role,
    joinedAt: m.joinedAt,
  }));
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
    memberCount: org._count.members,
  };
};

export const updateOrganization = async (orgId: string, data: UpdateOrgInput) => {
  const existingOrg = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!existingOrg) {
    throw new ApiError(404, 'Organization not found');
  }

  if (data.name !== undefined && data.name.trim().length === 0) {
    throw new ApiError(400, 'Organization name cannot be empty');
  }

  const updatedOrg = await prisma.organization.update({
    where: { id: orgId },
    data: {
      name: data.name !== undefined ? data.name.trim() : undefined,
      description: data.description !== undefined ? data.description.trim() : undefined,
      logo: data.logo !== undefined ? data.logo : undefined,
      email: data.email !== undefined ? data.email?.trim().toLowerCase() || null : undefined,
      industry: data.industry !== undefined ? data.industry?.trim() || null : undefined,
      teamSize: data.teamSize !== undefined ? data.teamSize?.trim() || null : undefined,

    },
  });

  return updatedOrg;
};

export const getOrganizationMembers = async (orgId: string) => {
  
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true },
  });

  if (!org) {
    throw new ApiError(404, 'Organization not found');
  }

  
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: orgId },
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

  return members.map((m) => ({
    id: m.id,
    userId: m.userId,
    role: m.role,
    joinedAt: m.joinedAt,
    user: m.user,
  }));
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
        throw new ApiError(400, 'This user is already a member of this organization');
      }
    }

    const pendingInvite = await prisma.organizationInvite.findFirst({
      where: {
        organizationId: orgId,
        email: normalizedEmail,
        isRevoked: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (pendingInvite) {
      throw new ApiError(400, 'An active invite has already been sent to this email');
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





