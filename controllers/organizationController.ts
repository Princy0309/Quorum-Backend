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
  createOrganizationInvite,
  getInvitePreview,
  acceptOrganizationInvite,
  getOrganizationInvites,
  revokeOrganizationInvite,
  deleteOrganization,
} from '../services/organizationService.js';

export const createOrganizationController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const { name, description, logo, email, industry, teamSize} = req.body;

    const organization = await createOrganization(req.user.id, {
      name,
      description,
      logo,
      email,
      industry,
      teamSize,
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

    const { name, description, logo, email, industry, teamSize } = req.body;

    const updatedOrg = await updateOrganization(orgId, {
      name,
      description,
      logo,
      email,
      industry,
      teamSize,
    });

    return res.status(200).json({
      success: true,
      data: updatedOrg,
    });
  }
);

export const deleteOrganizationController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.orgId || req.params.id;
    const orgId = typeof rawId === 'string' ? rawId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const result = await deleteOrganization(orgId, req.user!.id);

    return res.status(200).json({
      success: true,
      message: result.message,
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

export const createInviteController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const rawOrgId = req.params.orgId || req.params.id;
    const orgId = typeof rawOrgId === 'string' ? rawOrgId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const { email, role, teamId, teamRole, maxUses, expiresInDays } = req.body;

    const invite = await createOrganizationInvite(orgId, req.user.id, {
      email,
      role,
      teamId,
      teamRole,
      maxUses,
      expiresInDays,
    });

    return res.status(201).json({
      success: true,
      data: invite,
    });
  }
);

export const getInvitePreviewController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawToken = req.params.token;
    const token = typeof rawToken === 'string' ? rawToken.trim() : undefined;

    if (!token) {
      return next(new ApiError(400, 'Invite token is required'));
    }

    const preview = await getInvitePreview(token);

    return res.status(200).json({
      success: true,
      data: preview,
    });
  }
);

export const acceptInviteController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id || !req.user?.email) {
      return next(new ApiError(401, 'Unauthorized, login required'));
    }

    const rawToken = req.params.token;
    const token = typeof rawToken === 'string' ? rawToken.trim() : undefined;

    if (!token) {
      return next(new ApiError(400, 'Invite token is required'));
    }

    const member = await acceptOrganizationInvite(
      token,
      req.user.id,
      req.user.email
    );

    return res.status(200).json({
      success: true,
      data: member,
      message: 'Joined organization successfully',
    });
  }
);

export const getOrganizationInvitesController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawOrgId = req.params.orgId || req.params.id;
    const orgId = typeof rawOrgId === 'string' ? rawOrgId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const invites = await getOrganizationInvites(orgId);

    return res.status(200).json({
      success: true,
      data: invites,
    });
  }
);

export const revokeInviteController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawOrgId = req.params.orgId || req.params.id;
    const orgId = typeof rawOrgId === 'string' ? rawOrgId.trim() : undefined;
    const rawInviteId = req.params.inviteId;
    const inviteId = typeof rawInviteId === 'string' ? rawInviteId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    if (!inviteId) {
      return next(new ApiError(400, 'Invite ID is required'));
    }

    const result = await revokeOrganizationInvite(orgId, inviteId);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  }
);



