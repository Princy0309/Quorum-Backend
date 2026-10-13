import prisma from "../config/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { OrgRole } from '@prisma/client';

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





