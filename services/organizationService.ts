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

