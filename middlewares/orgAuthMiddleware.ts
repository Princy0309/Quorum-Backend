import { Request, Response, NextFunction } from 'express';
import { OrgRole, OrganizationMember } from '@prisma/client';
import prisma from '../config/prisma.js';
import { ApiError } from '../utils/ApiError.js';

declare global {
  namespace Express {
    interface Request {
      orgMembership?: OrganizationMember;
    }
  }
}

export const requireOrgMember = (allowedRoles?: OrgRole[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) {
        return next(new ApiError(401, 'Unauthorized, login required'));
      }

      const orgId = req.params.orgId || req.params.id;
      if (!orgId || typeof orgId !== 'string' || orgId.trim().length === 0) {
        return next(new ApiError(400, 'Valid Organization ID is required'));
      }

      const membership = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: orgId.trim(),
            userId: req.user.id,
          },
        },
      });

      if (!membership) {
        return next(new ApiError(403, 'Access denied: You are not a member of this organization'));
      }

      if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
        return next(
          new ApiError(403, `Forbidden: Requires one of [${allowedRoles.join(', ')}] role`)
        );
      }

      req.orgMembership = membership;
      return next();
    } catch (error) {
      return next(error);
    }
  };
};
