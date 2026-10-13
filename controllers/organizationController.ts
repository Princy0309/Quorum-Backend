import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  createOrganization,
  getUserOrganizations,
  getOrganizationById,
  updateOrganization,
  getOrganizationMembers,
  updateMemberRole,
  removeMember,
  leaveOrganization,
} from '../services/organizationService.js';

export const createOrganizationController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const { name, description, logo } = req.body;

    const organization = await createOrganization(req.user.id, {
      name,
      description,
      logo,
    });

    return res.status(201).json({
      success: true,
      data: organization,
    });
  }
);

export const getUserOrganizationsController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const organizations = await getUserOrganizations(req.user.id);

    return res.status(200).json({
      success: true,
      data: organizations,
    });
  }
);

export const getOrganizationController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.orgId || req.params.id;
    const orgId = typeof rawId === 'string' ? rawId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const organization = await getOrganizationById(orgId);

    return res.status(200).json({
      success: true,
      data: organization,
    });
  }
);

export const updateOrganizationController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.orgId || req.params.id;
    const orgId = typeof rawId === 'string' ? rawId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const { name, description, logo } = req.body;

    const updatedOrg = await updateOrganization(orgId, {
      name,
      description,
      logo,
    });

    return res.status(200).json({
      success: true,
      data: updatedOrg,
    });
  }
);

export const getOrganizationMembersController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.orgId || req.params.id;
    const orgId = typeof rawId === 'string' ? rawId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const members = await getOrganizationMembers(orgId);

    return res.status(200).json({
      success: true,
      data: members,
    });
  }
);

export const updateMemberRoleController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const rawOrgId = req.params.orgId || req.params.id;
    const orgId = typeof rawOrgId === 'string' ? rawOrgId.trim() : undefined;
    const rawUserId = req.params.userId;
    const targetUserId = typeof rawUserId === 'string' ? rawUserId.trim() : undefined;


    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    if (!targetUserId) {
      return next(new ApiError(400, 'Target User ID is required'));
    }

    const { role } = req.body;
    if (!role) {
      return next(new ApiError(400, 'New role is required'));
    }

    const updatedMember = await updateMemberRole(
      orgId,
      req.user.id,
      targetUserId,
      role
    );

    return res.status(200).json({
      success: true,
      data: updatedMember,
    });
  }
);

export const removeMemberController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const rawOrgId = req.params.orgId || req.params.id;
    const orgId = typeof rawOrgId === 'string' ? rawOrgId.trim() : undefined;
    const rawUserId = req.params.userId;
    const targetUserId = typeof rawUserId === 'string' ? rawUserId.trim() : undefined;


    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    if (!targetUserId) {
      return next(new ApiError(400, 'Target User ID is required'));
    }

    const result = await removeMember(orgId, req.user.id, targetUserId);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  }
);

export const leaveOrganizationController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const rawOrgId = req.params.orgId || req.params.id;
    const orgId = typeof rawOrgId === 'string' ? rawOrgId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const result = await leaveOrganization(orgId, req.user.id);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  }
);


