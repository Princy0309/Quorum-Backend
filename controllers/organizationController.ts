import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  createOrganization,
  getUserOrganizations,
  getOrganizationById,
  updateOrganization,
  updateOrganizationProfilePicture,
  deleteOrganizationProfilePicture,
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

    const { name, description, logo, avatar, profilePicture, email, industry, teamSize } = req.body;
    const uploadedFile = (req.files && Array.isArray(req.files) && req.files.length > 0)
      ? req.files[0]
      : ((req as any).file || undefined);

    if (uploadedFile) {
      const isImage = (uploadedFile.mimetype && uploadedFile.mimetype.startsWith('image/')) ||
        /\.(jpg|jpeg|png|gif|webp|svg|heic|avif)$/i.test(uploadedFile.originalname || '');
      if (!isImage) {
        return next(new ApiError(400, 'Profile picture must be an image file'));
      }
    }

    let resolvedLogo = logo !== undefined ? logo : (avatar !== undefined ? avatar : profilePicture);
    if (uploadedFile && req.user?.id) {
      const orgWithPic = await updateOrganizationProfilePicture(req.user.id, orgId, {}, uploadedFile);
      resolvedLogo = orgWithPic.logo;
    }

    const updatedOrg = await updateOrganization(orgId, {
      name,
      description,
      logo: resolvedLogo,
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

export const getOrganizationProfilePictureController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params.orgId || req.params.id;
    const orgId = typeof rawId === 'string' ? rawId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const org = await getOrganizationById(orgId);

    return res.status(200).json({
      success: true,
      data: {
        organizationId: org.id,
        logo: org.logo || null,
        avatar: org.logo || null,
        profilePicture: org.logo || null,
      },
    });
  }
);

export const updateOrganizationProfilePictureController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized'));
    }

    const rawId = req.params.orgId || req.params.id;
    const orgId = typeof rawId === 'string' ? rawId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const uploadedFile = (req.files && Array.isArray(req.files) && req.files.length > 0)
      ? req.files[0]
      : ((req as any).file || undefined);

    if (uploadedFile) {
      const isImage = (uploadedFile.mimetype && uploadedFile.mimetype.startsWith('image/')) ||
        /\.(jpg|jpeg|png|gif|webp|svg|heic|avif)$/i.test(uploadedFile.originalname || '');
      if (!isImage) {
        return next(new ApiError(400, 'Profile picture must be an image file'));
      }
    }

    const { logo, avatar, profilePicture, url, imageUrl } = req.body || {};
    const inputLogo = logo !== undefined ? logo : (avatar !== undefined ? avatar : (profilePicture !== undefined ? profilePicture : (url !== undefined ? url : imageUrl)));

    if (!uploadedFile && inputLogo === undefined) {
      return next(new ApiError(400, 'Either an image file or a valid picture URL must be provided'));
    }

    const updatedOrg = await updateOrganizationProfilePicture(
      req.user.id,
      orgId,
      { logo: inputLogo },
      uploadedFile
    );

    return res.status(200).json({
      success: true,
      message: 'Organization profile picture updated successfully',
      data: {
        organizationId: updatedOrg.id,
        name: updatedOrg.name,
        logo: updatedOrg.logo,
        avatar: updatedOrg.logo,
        profilePicture: updatedOrg.logo,
      },
    });
  }
);

export const deleteOrganizationProfilePictureController = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
      return next(new ApiError(401, 'Unauthorized'));
    }

    const rawId = req.params.orgId || req.params.id;
    const orgId = typeof rawId === 'string' ? rawId.trim() : undefined;

    if (!orgId) {
      return next(new ApiError(400, 'Valid Organization ID is required'));
    }

    const updatedOrg = await deleteOrganizationProfilePicture(req.user.id, orgId);

    return res.status(200).json({
      success: true,
      message: 'Organization profile picture removed successfully',
      data: {
        organizationId: updatedOrg.id,
        logo: null,
        avatar: null,
        profilePicture: null,
      },
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



