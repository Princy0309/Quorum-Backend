import { User, OrganizationMember } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: Omit<User, 'passwordHash'>;
      orgMembership?: OrganizationMember;
    }
  }
}

export {};
