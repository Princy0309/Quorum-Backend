import { OrgRole } from '@prisma/client';

export interface CreateOrgInput {
  name: string;
  description?: string;
  logo?: string;
  email?: string;
  industry?: string;
  teamSize?: string;

}

export interface UpdateOrgInput {
  name?: string;
  description?: string;
  logo?: string;
  email?: string;
  industry?: string;
  teamSize?: string;

}

export interface CreateInviteInput {
  email?: string;
  role?: OrgRole;
  maxUses?: number;
  expiresInDays?: number;
}

export interface OrgInviteEmailJobData {
  email: string;
  inviterName: string;
  orgName: string;
  role: string;
  inviteLink: string;
  expiresInDays?: number;
}
