import { OrgRole } from '@prisma/client';

export interface CreateOrgInput {
  name: string;
  description?: string;
  logo?: string;
}

export interface UpdateOrgInput {
  name?: string;
  description?: string;
  logo?: string;
}

export interface CreateInviteInput {
  email?: string;
  role?: OrgRole;
  maxUses?: number;
  expiresInDays?: number;
}
