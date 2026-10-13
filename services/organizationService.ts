import prisma from "../config/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { OrgRole } from '@prisma/client';
import crypto from 'crypto';

function slugify(text: string): string{
    return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
interface CreateOrgInput {
  name: string;
  description?: string;
  logo?: string;
}

export const createOrganization = async (userId: string, data: CreateOrgInput) => {
  const { name, description, logo } = data;

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

interface UpdateOrgInput {
  name?: string;
  description?: string;
  logo?: string;
}

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
    },
  });

  return updatedOrg;
};

//organization-creation

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


//invitations and join system

interface CreateInviteInput {
  email?: string;
  role?: OrgRole;
  maxUses?: number;
  expiresInDays?: number;
}

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
      role: targetRole,
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
    },
  });

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

  // Edge Case: Email Hijacking Protection
  if (invite.email && invite.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new ApiError(
      403,
      `This invite was sent specifically to ${invite.email}. Please sign in with that email address.`
    );
  }

  // Edge Case: Check if user is already a member
  const existingMember = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: invite.organizationId,
        userId,
      },
    },
  });

  if (existingMember) {
    throw new ApiError(400, 'You are already a member of this organization');
  }

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





